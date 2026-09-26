-- =====================================================================
-- STAFFLY: "PUNCH FROM ANYWHERE" (field staff exemption)
-- ---------------------------------------------------------------------
-- Listed employees can Punch In / Out from ANY location.
--   * GPS is still REQUIRED - their real location is saved on the
--     attendance row (lat/lng + distance from HQ), and shows on the map.
--   * Everything else stays the same: selfie, first-punch-wins, late after
--     11:15, half day < 4.5 hrs, 9 hr shift.
--   * Every punch made outside the 500 m office area is written to
--     audit_log as clock_in_anywhere / clock_out_anywhere.
--
-- Starting list: DCC201 (Salman Haider), DCC203 (Brajesh Kumar).
-- Add / remove people later with the SQL at the bottom - no app update.
-- Builds on 09 (punch guard). Safe to re-run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. The list (private schema: the app can't read or change it directly)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.anywhere_punch (
  employee_id text PRIMARY KEY REFERENCES public.employees(employee_id) ON UPDATE CASCADE ON DELETE CASCADE,
  note        text,
  added_at    timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.anywhere_punch FROM PUBLIC, anon, authenticated;

INSERT INTO private.anywhere_punch (employee_id, note) VALUES
  ('DCC201', 'Salman Haider - field staff'),
  ('DCC203', 'Brajesh Kumar - field staff')
ON CONFLICT (employee_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.can_punch_anywhere(p_employee_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT EXISTS (SELECT 1 FROM private.anywhere_punch a
                 WHERE upper(a.employee_id) = upper(p_employee_id));
$$;
REVOKE ALL ON FUNCTION private.can_punch_anywhere(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. clock_in  (= 09 version + anywhere check)
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
  v_anywhere         boolean := private.can_punch_anywhere(p_employee_id);
  v_outside          boolean;
BEGIN
  v_dist_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_office_lat) / 2), 2) +
      cos(radians(v_office_lat)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - v_office_lng) / 2), 2)));

  IF v_dist_m IS NULL THEN
    RETURN json_build_object('status', 'NO_LOCATION');
  END IF;

  v_effective := greatest(0, v_dist_m - least(coalesce(p_accuracy, 0), 100));
  v_outside   := v_effective > v_allowed_radius_m;
  IF v_outside AND NOT v_anywhere THEN
    RETURN json_build_object('status', 'OUT_OF_RANGE', 'distance_m', v_dist_m);
  END IF;

  v_status := CASE WHEN v_now_ist::time > v_grace_time THEN 'Late' ELSE 'Present' END;

  INSERT INTO public.attendance
    (employee_id, work_date, clock_in_time, clock_in_lat, clock_in_lng, distance_m, status)
  VALUES
    (p_employee_id, v_today, CURRENT_TIMESTAMP, p_lat, p_lng, v_dist_m, v_status)
  ON CONFLICT (employee_id, work_date) DO NOTHING;
  v_done := FOUND;

  IF NOT v_done THEN
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

    UPDATE public.attendance
    SET clock_in_time = CURRENT_TIMESTAMP, clock_in_lat = p_lat, clock_in_lng = p_lng,
        distance_m = v_dist_m, status = v_status
    WHERE employee_id = p_employee_id AND work_date = v_today
      AND clock_in_time IS NULL;
  END IF;

  IF v_outside THEN
    INSERT INTO public.audit_log (employee_id, action, details)
    VALUES (p_employee_id, 'clock_in_anywhere', jsonb_build_object(
      'lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy, 'distance_m', round(v_dist_m::numeric)));
  END IF;

  RETURN json_build_object('status', 'SUCCESS', 'distance_m', v_dist_m,
                           'attendance_status', v_status, 'anywhere', v_outside);
END $$;

-- ---------------------------------------------------------------------
-- 3. clock_out  (= 09 version + anywhere check)
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
  v_anywhere         boolean := private.can_punch_anywhere(p_employee_id);
  v_outside          boolean;
BEGIN
  v_dist_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_office_lat) / 2), 2) +
      cos(radians(v_office_lat)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - v_office_lng) / 2), 2)));

  IF v_dist_m IS NULL THEN
    RETURN json_build_object('status', 'NO_LOCATION');
  END IF;

  v_effective := greatest(0, v_dist_m - least(coalesce(p_accuracy, 0), 100));
  v_outside   := v_effective > v_allowed_radius_m;
  IF v_outside AND NOT v_anywhere THEN
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

  IF v_outside THEN
    INSERT INTO public.audit_log (employee_id, action, details)
    VALUES (p_employee_id, 'clock_out_anywhere', jsonb_build_object(
      'lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy, 'distance_m', round(v_dist_m::numeric)));
  END IF;

  RETURN json_build_object(
    'status', 'SUCCESS', 'distance_m', v_dist_m, 'hours_worked', v_hours,
    'attendance_status', v_status, 'shift_complete', v_complete, 'anywhere', v_outside,
    'shift_message', CASE WHEN v_complete THEN 'Shift Complete - 9 hours fulfilled.'
                          ELSE 'Shift Incomplete - only ' || v_hours::text || ' of 9 hours completed.' END);
END $$;

REVOKE ALL ON FUNCTION private.clock_in(text, double precision, double precision, double precision),
                       private.clock_out(text, double precision, double precision, double precision)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. App asks: "can I punch from anywhere?" (own answer only)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_my_punch_rules(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp text := private.session_employee_id(p_token);
BEGIN
  RETURN json_build_object('anywhere_punch', private.can_punch_anywhere(v_emp));
END $$;
REVOKE EXECUTE ON FUNCTION public.app_my_punch_rules(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.app_my_punch_rules(text) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- MANAGE THE LIST LATER (run in SQL Editor, no app update needed)
-- =====================================================================
-- See who is on it:
--   SELECT a.employee_id, e.name, a.note, a.added_at
--   FROM private.anywhere_punch a JOIN public.employees e USING (employee_id);
--
-- Add someone:
--   INSERT INTO private.anywhere_punch (employee_id, note) VALUES ('DCC2XX', 'reason');
--
-- Remove someone:
--   DELETE FROM private.anywhere_punch WHERE employee_id = 'DCC2XX';
--
-- Their punches from outside the office:
--   SELECT created_at, employee_id, action, details FROM public.audit_log
--   WHERE action IN ('clock_in_anywhere','clock_out_anywhere') ORDER BY created_at DESC;
--
-- UNDO this migration: re-run 09_staffly_punch_guard.sql, then
--   DROP FUNCTION IF EXISTS public.app_my_punch_rules(text);
--   DROP FUNCTION IF EXISTS private.can_punch_anywhere(text);
--   DROP TABLE IF EXISTS private.anywhere_punch;
