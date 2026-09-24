-- =====================================================================
-- STAFFLY: GOOGLE SHEET EXPORT KEY   (run AFTER staffly_security_fix)
-- ---------------------------------------------------------------------
-- Why the sheet stopped syncing: get_attendance_report_export is now
-- Admin-only and needs a login token. Apps Script has no login.
--
-- Fix: a separate read-only endpoint, export_attendance_report(p_export_key),
-- that works only with a secret key kept inside the Apps Script.
-- Only the SHA-256 hash of the key is stored here, never the key itself.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS private.export_keys (
  key_hash   bytea PRIMARY KEY,
  label      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO private.export_keys (key_hash, label)
VALUES (decode('127bb956dfe53613e464c919142ac48d38ca6f83d0ce5cc616aa51ffd62b3c95', 'hex'),
        'Google Sheet attendance sync')
ON CONFLICT (key_hash) DO NOTHING;

CREATE OR REPLACE FUNCTION private.require_export_key(p_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF p_key IS NULL OR length(p_key) < 32 OR NOT EXISTS (
       SELECT 1 FROM private.export_keys WHERE key_hash = digest(p_key, 'sha256')) THEN
    RAISE EXCEPTION 'INVALID_EXPORT_KEY' USING ERRCODE = '28000';
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

-- Build the public endpoint with the same return type as the original report.
DO $$
DECLARE
  v_oid    oid;
  v_nargs  int;
  v_result text;
  v_retset boolean;
  v_body   text;
BEGIN
  SELECT p.oid, p.pronargs - p.pronargdefaults, pg_get_function_result(p.oid), p.proretset
    INTO v_oid, v_nargs, v_result, v_retset
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = 'get_attendance_report_export';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'private.get_attendance_report_export not found - run staffly_security_fix first';
  END IF;
  IF v_nargs > 0 THEN
    RAISE EXCEPTION 'get_attendance_report_export has required args - adjust this script';
  END IF;

  v_body := CASE WHEN v_retset
    THEN 'SELECT * FROM private.get_attendance_report_export() WHERE private.require_export_key(p_export_key)'
    ELSE 'SELECT private.get_attendance_report_export() WHERE private.require_export_key(p_export_key)'
  END;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.export_attendance_report(p_export_key text) RETURNS %s '
    'LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions AS %L',
    v_result, v_body);
END $$;

REVOKE EXECUTE ON FUNCTION public.export_attendance_report(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_attendance_report(text) TO anon;

COMMIT;

-- To revoke this key later (e.g. if the sheet is shared with the wrong person):
--   DELETE FROM private.export_keys WHERE label = 'Google Sheet attendance sync';
