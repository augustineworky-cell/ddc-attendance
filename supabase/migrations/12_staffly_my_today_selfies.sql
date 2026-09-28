-- =====================================================================
-- STAFFLY: "TODAY'S SELFIES" on the Home screen  (v48)
-- ---------------------------------------------------------------------
-- public.get_my_today_selfies(p_token)
--   * Employee comes ONLY from the session token - nobody can read
--     anyone else's photos.
--   * TODAY only (India time). Read-only: changes no data.
--   * Returns only links that point into our own selfie folder.
-- Safe to re-run.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_today_selfies(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp    text := private.session_employee_id(p_token);
  v_today  date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date;
  v_prefix text := 'https://bpwpxhsdmbkymhpjsfej.supabase.co/storage/v1/object/public/attendance-media/selfies/';
  v_row    record;
BEGIN
  SELECT a.clock_in_time, a.clock_out_time,
         CASE WHEN left(a.photo_url, length(v_prefix)) = v_prefix THEN a.photo_url END            AS in_photo,
         CASE WHEN left(a.clock_out_photo_url, length(v_prefix)) = v_prefix THEN a.clock_out_photo_url END AS out_photo
  INTO v_row
  FROM public.attendance a
  WHERE a.employee_id = v_emp AND a.work_date = v_today;

  RETURN json_build_object(
    'status',         'SUCCESS',
    'clock_in_time',  v_row.clock_in_time,
    'clock_out_time', v_row.clock_out_time,
    'in_photo',       v_row.in_photo,
    'out_photo',      v_row.out_photo
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.get_my_today_selfies(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_today_selfies(text) TO anon, authenticated;

COMMIT;

-- VERIFY:  SELECT proname FROM pg_proc WHERE proname = 'get_my_today_selfies';
-- UNDO:    DROP FUNCTION IF EXISTS public.get_my_today_selfies(text);
