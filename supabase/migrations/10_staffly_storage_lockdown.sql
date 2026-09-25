-- =====================================================================
-- STAFFLY: STORAGE LOCKDOWN   (run AFTER 09, together with the new app.js)
-- ---------------------------------------------------------------------
-- Live audit (25-09-2026) found:
--   * attendance-media: anyone with the anon key could LIST + download
--     every selfie, and upload any file without logging in.
--   * leave-docs: same (public read + upload). 0 files, app doesn't use it.
--   * attach_attendance_photo accepted ANY url, and could overwrite
--     selfies on ANY past date.
--
-- After this:
--   * Nobody can list / browse the selfie folder any more.
--   * Uploads only allowed as  selfies/<EMPID>_<YYYY-MM-DD>_<clockin|clockout>_<ms>[_<16 hex>].webp
--     (the new app.js adds a random 16-char code, so links can't be guessed).
--   * Selfie links you already have (Google Sheet etc.) KEEP WORKING -
--     the bucket stays "link-only": a photo opens only if you have its
--     exact link.
--   * attach_attendance_photo: only today's row, only your own selfie,
--     file must really exist in storage, and an attached selfie can't be
--     replaced.
--   * leave-docs: fully private (no anon access at all).
--
-- NOT done here (phase 2): fully private selfies with expiring signed
-- links. Needs an Edge Function + a way for HR to view photos.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. attendance-media
-- ---------------------------------------------------------------------
-- No listing / browsing. (Public object URLs don't use this policy, so
-- existing links still open.)
DROP POLICY IF EXISTS "Allow public reads from attendance-media" ON storage.objects;

-- Uploads: selfies folder + strict file name only.
DROP POLICY IF EXISTS "Allow public uploads to attendance-media" ON storage.objects;
DROP POLICY IF EXISTS "staffly_selfie_upload" ON storage.objects;
CREATE POLICY "staffly_selfie_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'attendance-media'
    AND name ~ '^selfies/[A-Za-z0-9-]+_\d{4}-\d{2}-\d{2}_(clockin|clockout)_\d{13}(_[a-f0-9]{16})?\.webp$'
  );
-- NOTE: the "(_[a-f0-9]{16})?" part is optional so phones still on the
-- old app version can upload. After everyone has updated, make it
-- required by removing the "( ... )?" wrapper.

-- ---------------------------------------------------------------------
-- 2. leave-docs: fully private (0 files, not used by the app today)
-- ---------------------------------------------------------------------
UPDATE storage.buckets SET public = false WHERE id = 'leave-docs';
DROP POLICY IF EXISTS "Public Access Leave Docs" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload Leave Docs" ON storage.objects;

-- ---------------------------------------------------------------------
-- 3. attach_attendance_photo: validated, today only, no overwrite
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_attendance_photo(
  p_token text, p_work_date date, p_photo_url text, p_event_type text DEFAULT 'clockin')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp    text := private.session_employee_id(p_token);
  v_today  date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date;
  v_event  text := lower(coalesce(p_event_type, 'clockin'));
  v_prefix text := 'https://bpwpxhsdmbkymhpjsfej.supabase.co/storage/v1/object/public/attendance-media/';
  v_path   text;
  v_row    public.attendance%ROWTYPE;
BEGIN
  -- p_work_date is ignored on purpose: the server decides "today".
  IF v_event NOT IN ('clockin', 'clockout') THEN
    RETURN false;
  END IF;

  -- Must be our own bucket...
  IF p_photo_url IS NULL OR left(p_photo_url, length(v_prefix)) <> v_prefix THEN
    RETURN false;
  END IF;
  v_path := substr(p_photo_url, length(v_prefix) + 1);

  -- ...this employee's file, for today, for this event...
  IF lower(v_path) NOT LIKE lower('selfies/' || v_emp || '\_' || v_today::text || '\_' || v_event || '\_%') THEN
    RETURN false;
  END IF;

  -- ...and the file must really be there.
  IF NOT EXISTS (SELECT 1 FROM storage.objects
                 WHERE bucket_id = 'attendance-media' AND name = v_path) THEN
    RETURN false;
  END IF;

  SELECT * INTO v_row FROM public.attendance
  WHERE employee_id = v_emp AND work_date = v_today
  FOR UPDATE;

  IF v_event = 'clockout' THEN
    IF v_row.clock_out_time IS NULL THEN RETURN false; END IF;
    IF v_row.clock_out_photo_url IS NOT NULL THEN
      RETURN v_row.clock_out_photo_url = p_photo_url;   -- same photo again = OK, different = no
    END IF;
    UPDATE public.attendance SET clock_out_photo_url = p_photo_url
    WHERE employee_id = v_emp AND work_date = v_today;
  ELSE
    IF v_row.clock_in_time IS NULL THEN RETURN false; END IF;
    IF v_row.photo_url IS NOT NULL THEN
      RETURN v_row.photo_url = p_photo_url;
    END IF;
    UPDATE public.attendance SET photo_url = p_photo_url
    WHERE employee_id = v_emp AND work_date = v_today;
  END IF;

  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.attach_attendance_photo(text, date, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.attach_attendance_photo(text, date, text, text) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY (read-only)
-- =====================================================================
-- SELECT id, public FROM storage.buckets;                        -- leave-docs = false
-- SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'storage';
--   expect ONLY: staffly_selfie_upload | INSERT
