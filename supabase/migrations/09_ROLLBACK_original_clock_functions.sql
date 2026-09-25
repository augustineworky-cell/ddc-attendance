-- =====================================================================
-- ROLLBACK for 09 + 10: the ORIGINAL live function bodies, copied from
-- the database on 25-09-2026 before any fix. Run only if you need to undo.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION private.clock_in(p_employee_id text, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL::double precision)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_office_lat double precision := 28.56616;
    v_office_lng double precision := 77.19904;
    v_allowed_radius_m double precision := 500.0;
    v_dist_m double precision;
    v_forgiveness double precision;
    v_effective_distance double precision;
    v_now timestamp with time zone := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
    v_today date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date;
    v_grace_time time := '11:15:00';
    v_initial_status text;
BEGIN
    v_dist_m := 6371000 * 2 * asin(sqrt(
        power(sin(radians(p_lat - v_office_lat) / 2), 2) +
        cos(radians(v_office_lat)) * cos(radians(p_lat)) *
        power(sin(radians(p_lng - v_office_lng) / 2), 2)
    ));
    v_forgiveness := least(coalesce(p_accuracy, 0), 100);
    v_effective_distance := greatest(0, v_dist_m - v_forgiveness);
    IF v_effective_distance > v_allowed_radius_m THEN
        RETURN json_build_object('status', 'OUT_OF_RANGE', 'distance_m', v_dist_m);
    END IF;
    IF v_now::time > v_grace_time THEN
        v_initial_status := 'Late';
    ELSE
        v_initial_status := 'Present';
    END IF;
    IF EXISTS (SELECT 1 FROM public.attendance WHERE employee_id = p_employee_id AND work_date = v_today) THEN
        UPDATE public.attendance
        SET clock_in_time = CURRENT_TIMESTAMP, clock_in_lat = p_lat, clock_in_lng = p_lng,
            distance_m = v_dist_m, status = v_initial_status
        WHERE employee_id = p_employee_id AND work_date = v_today;
    ELSE
        INSERT INTO public.attendance (employee_id, work_date, clock_in_time, clock_in_lat, clock_in_lng, distance_m, status)
        VALUES (p_employee_id, v_today, CURRENT_TIMESTAMP, p_lat, p_lng, v_dist_m, v_initial_status);
    END IF;
    RETURN json_build_object('status', 'SUCCESS', 'distance_m', v_dist_m, 'attendance_status', v_initial_status);
END;
$$;

CREATE OR REPLACE FUNCTION private.clock_out(p_employee_id text, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL::double precision)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_office_lat double precision := 28.56616;
    v_office_lng double precision := 77.19904;
    v_allowed_radius_m double precision := 500.0;
    v_required_shift_hours numeric := 9.0;
    v_dist_m double precision;
    v_forgiveness double precision;
    v_effective_distance double precision;
    v_now timestamp with time zone := CURRENT_TIMESTAMP;
    v_today date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date;
    v_clock_in_time timestamp with time zone;
    v_hours_worked numeric;
    v_current_status text;
    v_final_status text;
    v_shift_complete boolean;
BEGIN
    v_dist_m := 6371000 * 2 * asin(sqrt(
        power(sin(radians(p_lat - v_office_lat) / 2), 2) +
        cos(radians(v_office_lat)) * cos(radians(p_lat)) *
        power(sin(radians(p_lng - v_office_lng) / 2), 2)
    ));
    v_forgiveness := least(coalesce(p_accuracy, 0), 100);
    v_effective_distance := greatest(0, v_dist_m - v_forgiveness);
    IF v_effective_distance > v_allowed_radius_m THEN
        RETURN json_build_object('status', 'OUT_OF_RANGE', 'distance_m', v_dist_m,
            'message', 'Punch Out not matching with Punch In location or not under 500m, hence Punch Out pending and 9 hours shift not completed.');
    END IF;
    SELECT clock_in_time, status INTO v_clock_in_time, v_current_status
    FROM public.attendance WHERE employee_id = p_employee_id AND work_date = v_today;
    IF v_clock_in_time IS NULL THEN
        RETURN json_build_object('status', 'NO_CLOCK_IN');
    END IF;
    v_hours_worked := ROUND(EXTRACT(EPOCH FROM (v_now - v_clock_in_time))/3600.0, 2);
    v_shift_complete := v_hours_worked >= v_required_shift_hours;
    IF v_hours_worked < (v_required_shift_hours / 2) THEN
        v_final_status := 'Half Day';
    ELSE
        v_final_status := COALESCE(v_current_status, 'Present');
    END IF;
    UPDATE public.attendance
    SET clock_out_time = CURRENT_TIMESTAMP, clock_out_lat = p_lat, clock_out_lng = p_lng,
        distance_m = v_dist_m, hours_worked = v_hours_worked, status = v_final_status
    WHERE employee_id = p_employee_id AND work_date = v_today;
    RETURN json_build_object('status', 'SUCCESS', 'distance_m', v_dist_m, 'hours_worked', v_hours_worked,
        'attendance_status', v_final_status, 'shift_complete', v_shift_complete,
        'shift_message', CASE WHEN v_shift_complete THEN 'Shift Complete - 9 hours fulfilled.'
            ELSE 'Shift Incomplete - only ' || v_hours_worked::text || ' of 9 hours completed.' END);
END;
$$;

-- original public wrapper for the selfie attach (undoes 10)
CREATE OR REPLACE FUNCTION public.attach_attendance_photo(p_token text, p_work_date date, p_photo_url text, p_event_type text DEFAULT 'clockin'::text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions AS
$$ SELECT private.attach_attendance_photo(private.session_employee_id(p_token), p_work_date, p_photo_url, p_event_type) $$;

COMMIT;

-- Storage rollback (undoes 10), only if really needed:
-- CREATE POLICY "Allow public reads from attendance-media" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'attendance-media');
-- DROP POLICY IF EXISTS "staffly_selfie_upload" ON storage.objects;
-- CREATE POLICY "Allow public uploads to attendance-media" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'attendance-media');
