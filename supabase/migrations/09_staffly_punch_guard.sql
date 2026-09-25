-- =====================================================================
-- STAFFLY: PUNCH GUARD   (project bpwpxhsdmbkymhpjsfej)
-- ---------------------------------------------------------------------
-- Fixes found in the live DB audit (25-09-2026):
--   1. clock_in OVERWROTE an existing punch-in. A second Punch In (weak
--      network showing the wrong button, a 2nd phone, an old open screen)
--      replaced the real in-time. Now: first punch-in of the day is final.
--      Returns ALREADY_CLOCKED_IN / ALREADY_CLOCKED_OUT instead
--      (the app already understands both).
--   2. Double-tap race: two punch-ins at the same instant are now safe
--      (INSERT ... ON CONFLICT on attendance_employee_id_work_date_key).
--   3. clock_out kept "Half Day" forever. An accidental early Punch Out
--      (e.g. 2 hrs) followed by the real one at 9 hrs stayed Half Day.
--      Now the status is re-calculated from the real in/out times on
--      every Punch Out: <4.5 hrs = Half Day, in after 11:15 = Late,
--      else Present.
--
-- Unchanged: 500 m radius, accuracy forgiveness (max 100 m), 11:15 grace,
-- 9 hr shift, office Wi-Fi fallback (public.clock_in/clock_out wrappers
-- call these private functions, so the guard covers the Wi-Fi path too).
-- Safe to re-run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. clock_in: first punch of the day wins
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.clock_in(
  p_employee_id text, p_lat double precision, p_lng double precision,
  p_accuracy double precision DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_office_lat       double precision := 28.56616;
  v_office_lng       double precision := 77.19904;
  v_allowed_radius_m double precision := 500.0;
  v_grace_time       time := '11:15:00';
  v_now_ist          timestamp := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
  v_today            date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date;
  v_dist_m           double precision;
  v_effective        double precision;
  v_status           text;
  v_row              public.attendance%ROWTYPE;
  v_done             boolean := false;
BEGIN
  v_dist_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_office_lat) / 2), 2) +
      cos(radians(v_office_lat)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - v_office_lng) / 2), 2)));

  v_effective := greatest(0, v_dist_m - least(coalesce(p_accuracy, 0), 100));
  IF v_dist_m IS NULL OR v_effective > v_allowed_radius_m THEN
    RETURN json_build_object('status', 'OUT_OF_RANGE', 'distance_m', v_dist_m);
  END IF;

  v_status := CASE WHEN v_now_ist::time > v_grace_time THEN 'Late' ELSE 'Present' END;

  -- Brand-new day: insert. Two taps at once -> only one row wins.
  INSERT INTO public.attendance
    (employee_id, work_date, clock_in_time, clock_in_lat, clock_in_lng, distance_m, status)
  VALUES
    (p_employee_id, v_today, CURRENT_TIMESTAMP, p_lat, p_lng, v_dist_m, v_status)
  ON CONFLICT (employee_id, work_date) DO NOTHING;
  v_done := FOUND;

  IF NOT v_done THEN
    -- A row already exists for today. Lock it and look.
    SELECT * INTO v_row FROM public.attendance
    WHERE employee_id = p_employee_id AND work_date = v_today
    FOR UPDATE;

    IF v_row.clock_out_time IS NOT NULL THEN
      RETURN json_build_object('status', 'ALREADY_CLOCKED_OUT',
        'clock_in_time', v_row.clock_in_time, 'clock_out_time', v_row.clock_out_time);
    ELSIF v_row.clock_in_time IS NOT NULL THEN
      RETURN json_build_object('status', 'ALREADY_CLOCKED_IN',
        'clock_in_time', v_row.clock_in_time);
    END IF;

    -- Row exists but has no punch yet (e.g. created by another process):
    -- fill it in.
    UPDATE public.attendance
    SET clock_in_time = CURRENT_TIMESTAMP, clock_in_lat = p_lat, clock_in_lng = p_lng,
        distance_m = v_dist_m, status = v_status
    WHERE employee_id = p_employee_id AND work_date = v_today
      AND clock_in_time IS NULL;
  END IF;

  RETURN json_build_object('status', 'SUCCESS', 'distance_m', v_dist_m,
                           'attendance_status', v_status);
END $$;

-- ---------------------------------------------------------------------
-- 2. clock_out: status re-calculated from real times every time
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.clock_out(
  p_employee_id text, p_lat double precision, p_lng double precision,
  p_accuracy double precision DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_office_lat       double precision := 28.56616;
  v_office_lng       double precision := 77.19904;
  v_allowed_radius_m double precision := 500.0;
  v_required_hours   numeric := 9.0;
  v_grace_time       time := '11:15:00';
  v_today            date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date;
  v_dist_m           double precision;
  v_effective        double precision;
  v_clock_in         timestamptz;
  v_hours            numeric;
  v_status           text;
  v_complete         boolean;
BEGIN
  v_dist_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_office_lat) / 2), 2) +
      cos(radians(v_office_lat)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - v_office_lng) / 2), 2)));

  v_effective := greatest(0, v_dist_m - least(coalesce(p_accuracy, 0), 100));
  IF v_dist_m IS NULL OR v_effective > v_allowed_radius_m THEN
    RETURN json_build_object('status', 'OUT_OF_RANGE', 'distance_m', v_dist_m,
      'message', 'Punch Out not matching with Punch In location or not under 500m, hence Punch Out pending and 9 hours shift not completed.');
  END IF;

  SELECT clock_in_time INTO v_clock_in FROM public.attendance
  WHERE employee_id = p_employee_id AND work_date = v_today
  FOR UPDATE;

  IF v_clock_in IS NULL THEN
    RETURN json_build_object('status', 'NO_CLOCK_IN');
  END IF;

  v_hours    := round(extract(epoch FROM (CURRENT_TIMESTAMP - v_clock_in)) / 3600.0, 2);
  v_complete := v_hours >= v_required_hours;
  v_status   := CASE
                  WHEN v_hours < v_required_hours / 2 THEN 'Half Day'
                  WHEN (v_clock_in AT TIME ZONE 'Asia/Kolkata')::time > v_grace_time THEN 'Late'
                  ELSE 'Present'
                END;

  UPDATE public.attendance
  SET clock_out_time = CURRENT_TIMESTAMP, clock_out_lat = p_lat, clock_out_lng = p_lng,
      distance_m = v_dist_m, hours_worked = v_hours, status = v_status
  WHERE employee_id = p_employee_id AND work_date = v_today;

  RETURN json_build_object(
    'status', 'SUCCESS', 'distance_m', v_dist_m, 'hours_worked', v_hours,
    'attendance_status', v_status, 'shift_complete', v_complete,
    'shift_message', CASE WHEN v_complete THEN 'Shift Complete - 9 hours fulfilled.'
                          ELSE 'Shift Incomplete - only ' || v_hours::text || ' of 9 hours completed.' END);
END $$;

REVOKE ALL ON FUNCTION private.clock_in(text, double precision, double precision, double precision),
                       private.clock_out(text, double precision, double precision, double precision)
  FROM PUBLIC, anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY (read-only)
-- =====================================================================
-- SELECT prosrc LIKE '%ALREADY_CLOCKED_IN%' AS guard_on
-- FROM pg_proc WHERE pronamespace = 'private'::regnamespace AND proname = 'clock_in';
--
-- ROLLBACK (restores old behaviour): re-run the original bodies saved in
-- 09_ROLLBACK_original_clock_functions.sql
