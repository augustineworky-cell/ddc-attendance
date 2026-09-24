-- =====================================================================
-- STAFFLY: BACKEND HARDENING  (from the full backend audit)
-- Run AFTER staffly_office_wifi. Everything here is safe to re-run.
-- ---------------------------------------------------------------------
--  1. HIGH   Wipe plaintext passwords (employees.login_password)
--  2. LOW    Drop dead pre-security login functions, lock distance_meters,
--            fix mutable search_path warnings
--  3. LOW    Remove the duplicate unique index on attendance
--  4. INFO   Index the 4 unindexed foreign keys
--  5. LOW    Storage: size + file-type limits; leave-docs to anon/auth only
--  6. MEDIUM Data rules the database now enforces itself (CHECKs)
--  7. MEDIUM offices table synced to the real geofence values
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Plaintext passwords
--    Login uses password_hash (bcrypt) only since staffly_security_fix;
--    login_password is no longer read by anything except the old
--    login_with_password, which is dropped below.
-- ---------------------------------------------------------------------
UPDATE public.employees SET login_password = NULL WHERE login_password IS NOT NULL;

-- Nothing may ever write a plaintext password here again.
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_no_plaintext_password;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_no_plaintext_password CHECK (login_password IS NULL);
COMMENT ON COLUMN public.employees.login_password IS
  'DEPRECATED - always NULL. Passwords live only in password_hash (bcrypt).';

-- ---------------------------------------------------------------------
-- 2. Dead functions + search_path hygiene
-- ---------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  -- Old entry points, unreachable since staffly_security_fix.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('login', 'login_with_password', 'getEmployeeLeaves')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
    RAISE NOTICE 'dropped %', r.sig;
  END LOOP;

  -- Pure math helper: keep it (private functions may use it) but not public.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'distance_meters'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'pin_is_weak'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. Duplicate unique index on attendance(employee_id, work_date)
--    Keep whichever one a function refers to by name (ON CONFLICT ON
--    CONSTRAINT ...); drop the other. Never drops the last one.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  a text := 'attendance_emp_date_unique';
  b text := 'attendance_employee_id_work_date_key';
  a_used boolean;
  b_used boolean;
  victim text;
  is_con boolean;
BEGIN
  IF to_regclass('public.' || a) IS NULL OR to_regclass('public.' || b) IS NULL THEN
    RAISE NOTICE 'attendance: no duplicate index pair found, skipping';
    RETURN;
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE prosrc ILIKE '%' || a || '%') INTO a_used;
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE prosrc ILIKE '%' || b || '%') INTO b_used;
  IF a_used AND b_used THEN
    RAISE NOTICE 'attendance: both index names are referenced by functions, keeping both';
    RETURN;
  END IF;
  victim := CASE WHEN a_used THEN b ELSE a END;

  SELECT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = victim AND conrelid = 'public.attendance'::regclass) INTO is_con;
  IF is_con THEN
    EXECUTE format('ALTER TABLE public.attendance DROP CONSTRAINT %I', victim);
  ELSE
    EXECUTE format('DROP INDEX public.%I', victim);
  END IF;
  RAISE NOTICE 'attendance: dropped duplicate %', victim;
END $$;

-- ---------------------------------------------------------------------
-- 4. Indexes for foreign keys (joins + ON DELETE CASCADE lookups)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.employees') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS employees_office_id_idx ON public.employees(office_id);
  END IF;
  IF to_regclass('public.leaves') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS leaves_employee_id_idx ON public.leaves(employee_id);
  END IF;
  IF to_regclass('public.location_pings') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS location_pings_employee_id_idx ON public.location_pings(employee_id);
  END IF;
  IF to_regclass('private.passkeys') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS passkeys_employee_id_idx ON private.passkeys(employee_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Storage limits
-- ---------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;

  -- Selfies: full camera resolution JPEG + watermark (uploaded with an
  -- image/webp label) - usually 0.2-1.5 MB; 5 MB leaves plenty of room.
  UPDATE storage.buckets
  SET file_size_limit = 5 * 1024 * 1024,
      allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png']
  WHERE id = 'attendance-media';

  -- Medical certificates etc.
  UPDATE storage.buckets
  SET file_size_limit = 5 * 1024 * 1024,
      allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  WHERE id = 'leave-docs';

  -- leave-docs policies granted to "public" -> only the app's roles.
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND 'public' = ANY (roles)
      AND (coalesce(qual, '') ILIKE '%leave-docs%' OR coalesce(with_check, '') ILIKE '%leave-docs%')
  LOOP
    EXECUTE format('ALTER POLICY %I ON storage.objects TO anon, authenticated', r.policyname);
    RAISE NOTICE 'storage policy % now anon/authenticated only', r.policyname;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 6. Data rules enforced by the database
--    (All existing data already passes: status is Active only, leaves and
--    salary_config are empty.)
-- ---------------------------------------------------------------------
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_status_check CHECK (status IN ('Active', 'Inactive'));

DO $$
BEGIN
  IF to_regclass('public.leaves') IS NOT NULL THEN
    ALTER TABLE public.leaves DROP CONSTRAINT IF EXISTS leaves_status_check;
    ALTER TABLE public.leaves
      ADD CONSTRAINT leaves_status_check CHECK (status IN ('Pending', 'Approved', 'Rejected'));
    ALTER TABLE public.leaves DROP CONSTRAINT IF EXISTS leaves_dates_check;
    ALTER TABLE public.leaves
      ADD CONSTRAINT leaves_dates_check CHECK (to_date >= from_date);
  END IF;
  IF to_regclass('public.salary_config') IS NOT NULL THEN
    ALTER TABLE public.salary_config DROP CONSTRAINT IF EXISTS salary_config_month_check;
    ALTER TABLE public.salary_config
      ADD CONSTRAINT salary_config_month_check CHECK (month_str ~ '^\d{4}-(0[1-9]|1[0-2])$');
    ALTER TABLE public.salary_config DROP CONSTRAINT IF EXISTS salary_config_amount_check;
    ALTER TABLE public.salary_config
      ADD CONSTRAINT salary_config_amount_check CHECK (amount >= 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 7. offices = the real geofence (clock_in/clock_out use these values)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.offices') IS NULL THEN RETURN; END IF;
  UPDATE public.offices
  SET lat = 28.56616, lng = 77.19904, radius_m = 500
  WHERE id = '11111111-1111-1111-1111-111111111111';
  COMMENT ON TABLE public.offices IS
    'Office reference data. NOTE: clock_in/clock_out and private.office_point() currently '
    'use hard-coded 28.56616, 77.19904, 500 m - change them together with this row.';
END $$;

COMMIT;

-- =====================================================================
-- VERIFY (read-only)
-- =====================================================================
-- SELECT count(*) FILTER (WHERE login_password IS NOT NULL) AS plaintext_left FROM public.employees;   -- expect 0
-- SELECT indexname FROM pg_indexes WHERE tablename = 'attendance';
-- SELECT id, file_size_limit, allowed_mime_types FROM storage.buckets;
