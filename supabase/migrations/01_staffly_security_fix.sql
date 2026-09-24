-- =====================================================================
-- STAFFLY SECURITY FIX  (project bpwpxhsdmbkymhpjsfej)
-- ---------------------------------------------------------------------
-- What this does:
--   1. Adds real sessions: app_login(employee_id, password) -> token
--      (bcrypt check, 5 wrong tries = 15 min lock).
--   2. Moves every original RPC into schema "private" (NOT exposed by the
--      API, anon cannot execute) - bodies are untouched.
--   3. Creates same-named public wrappers that take p_token first and
--      resolve WHO is calling on the server:
--        self          -> employee_id comes from the token, never the client
--        self_or_admin -> employees see only their own, Admin/HR/Dev anyone
--        admin         -> Admin/HR/Dev only
--        any           -> any logged-in user
--   4. Creates the missing update_user().
--   5. Hashes the live plaintext passwords into password_hash.
--   6. Stops anyone overwriting selfies in attendance-media.
--
-- Reversible: originals are only moved, e.g.
--   ALTER FUNCTION private.clock_in(text,double precision,...) SET SCHEMA public;
-- =====================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. SESSION + LOCKOUT TABLES (private schema = invisible to the API)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.app_sessions (
  token_hash  bytea PRIMARY KEY,               -- sha256 of token, raw token never stored
  employee_id text NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_emp_idx ON private.app_sessions(employee_id);

CREATE TABLE IF NOT EXISTS private.login_attempts (
  login_key    text PRIMARY KEY,               -- lower(employee_id typed)
  failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz
);

-- ---------------------------------------------------------------------
-- 2. GUARD HELPERS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.session_employee_id(p_token text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_emp text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '28000';
  END IF;
  SELECT s.employee_id INTO v_emp
  FROM private.app_sessions s
  JOIN public.employees e ON e.employee_id = s.employee_id
  WHERE s.token_hash = digest(p_token, 'sha256')
    AND s.expires_at > now()
    AND e.status = 'Active';
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = '28000';
  END IF;
  RETURN v_emp;
END $$;

CREATE OR REPLACE FUNCTION private.is_admin_role(p_employee_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees
                 WHERE employee_id = p_employee_id
                   AND role IN ('Admin','HR','Dev'));
$$;

CREATE OR REPLACE FUNCTION private.require_session(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM private.session_employee_id(p_token);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION private.require_admin(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT private.is_admin_role(private.session_employee_id(p_token)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END $$;

-- Employee asking about themself -> OK. Admin asking about anyone -> OK.
-- Employee asking about someone else -> FORBIDDEN.
CREATE OR REPLACE FUNCTION private.resolve_employee(p_token text, p_requested text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_caller text := private.session_employee_id(p_token);
BEGIN
  IF p_requested IS NULL OR p_requested = v_caller THEN
    RETURN v_caller;
  END IF;
  IF private.is_admin_role(v_caller) THEN
    RETURN p_requested;
  END IF;
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. HASH THE LIVE PLAINTEXT PASSWORDS
--    login_password is what staff type today, so it becomes the hash.
--    NOTE: login is now CASE-SENSITIVE (old one lowercased both sides).
-- ---------------------------------------------------------------------
UPDATE public.employees
SET password_hash = crypt(login_password, gen_salt('bf'))
WHERE login_password IS NOT NULL AND login_password <> '';

-- ---------------------------------------------------------------------
-- 4. LOGIN / WHOAMI / LOGOUT
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_login(p_employee_id text, p_password text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_key   text := lower(trim(coalesce(p_employee_id, '')));
  v_att   private.login_attempts%ROWTYPE;
  v_emp   record;
  v_token text;
  v_exp   timestamptz := now() + interval '16 hours';
BEGIN
  IF v_key = '' OR coalesce(p_password, '') = '' THEN
    RETURN json_build_object('status', 'INVALID_CREDENTIALS');
  END IF;

  SELECT * INTO v_att FROM private.login_attempts WHERE login_key = v_key;
  IF v_att.locked_until IS NOT NULL AND v_att.locked_until > now() THEN
    RETURN json_build_object('status', 'LOCKED',
      'retry_after_minutes', ceil(extract(epoch FROM v_att.locked_until - now()) / 60));
  END IF;

  SELECT employee_id, name, role, password_hash INTO v_emp
  FROM public.employees
  WHERE lower(employee_id) = v_key AND status = 'Active';

  IF v_emp.employee_id IS NULL
     OR v_emp.password_hash IS NULL
     OR v_emp.password_hash <> crypt(p_password, v_emp.password_hash) THEN
    INSERT INTO private.login_attempts AS la (login_key, failed_count)
    VALUES (v_key, 1)
    ON CONFLICT (login_key) DO UPDATE
      SET failed_count = CASE WHEN la.failed_count + 1 >= 5 THEN 0 ELSE la.failed_count + 1 END,
          locked_until = CASE WHEN la.failed_count + 1 >= 5 THEN now() + interval '15 minutes'
                              ELSE la.locked_until END;
    RETURN json_build_object('status', 'INVALID_CREDENTIALS');
  END IF;

  DELETE FROM private.login_attempts WHERE login_key = v_key;
  DELETE FROM private.app_sessions WHERE expires_at < now();

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO private.app_sessions (token_hash, employee_id, expires_at)
  VALUES (digest(v_token, 'sha256'), v_emp.employee_id, v_exp);

  RETURN json_build_object(
    'status', 'SUCCESS', 'token', v_token, 'expires_at', v_exp,
    'employee_id', v_emp.employee_id, 'employee_name', v_emp.name, 'role', v_emp.role);
END $$;

-- Validates a stored token on page load. Never raises.
CREATE OR REPLACE FUNCTION public.app_whoami(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_emp text; v_row record;
BEGIN
  BEGIN
    v_emp := private.session_employee_id(p_token);
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('status', 'INVALID');
  END;
  SELECT employee_id, name, role INTO v_row FROM public.employees WHERE employee_id = v_emp;
  RETURN json_build_object('status', 'SUCCESS', 'employee_id', v_row.employee_id,
                           'employee_name', v_row.name, 'role', v_row.role);
END $$;

CREATE OR REPLACE FUNCTION public.app_logout(p_token text)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions AS $$
  DELETE FROM private.app_sessions WHERE token_hash = digest(coalesce(p_token, ''), 'sha256');
$$;

-- ---------------------------------------------------------------------
-- 5. KILL THE OLD UNGUARDED ENTRY POINTS (no wrapper = unreachable)
-- ---------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('login', 'login_with_password', 'getEmployeeLeaves', 'rls_auto_enable')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 6. MOVE ORIGINALS TO private + GENERATE GUARDED WRAPPERS
-- ---------------------------------------------------------------------
DO $$
DECLARE
  m        record;
  v_oid    oid;
  v_cnt    int;
  v_args   text;
  v_result text;
  v_retset boolean;
  v_parts  text[];
  v_part   text;
  v_name   text;
  w_sig    text[];
  w_call   text[];
  v_guard  text;
  v_body   text;
  v_has_emp boolean;
BEGIN
  FOR m IN SELECT * FROM (VALUES
      ('clock_in','self'), ('clock_out','self'), ('ping_location','self'),
      ('attach_attendance_photo','self'), ('apply_leave','self'),
      ('attach_leave_document','self'), ('get_today_attendance','self'),
      ('get_employee_leaves','self_or_admin'), ('get_salary_details','self_or_admin'),
      ('get_dashboard_metrics','self_or_admin'), ('get_dashboard_charts','self_or_admin'),
      ('get_all_pending_leaves','admin'), ('update_leave_status','admin'),
      ('save_salary_config','admin'), ('add_training','admin'),
      ('get_live_locations','admin'), ('get_users','admin'),
      ('get_overall_metrics','admin'), ('get_overall_charts','admin'),
      ('get_audit_logs','admin'), ('get_attendance_report_export','admin'),
      ('get_employees_directory','any'), ('get_training_list','any'),
      ('get_employee_names','any')
    ) AS t(fname, mode)
  LOOP
    SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = m.fname;

    IF v_cnt = 0 THEN
      RAISE NOTICE 'skip %: not found in public', m.fname;
      CONTINUE;
    ELSIF v_cnt > 1 THEN
      RAISE EXCEPTION '% has % overloads in public - resolve manually first', m.fname, v_cnt;
    END IF;

    SELECT p.oid, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid), p.proretset
      INTO v_oid, v_args, v_result, v_retset
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = m.fname;

    -- move original out of the API + lock it down
    EXECUTE format('ALTER FUNCTION %s SET SCHEMA private', v_oid::regprocedure);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', v_oid::regprocedure);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_oid::regprocedure);

    -- build wrapper signature + call list
    w_sig := ARRAY['p_token text'];
    w_call := ARRAY[]::text[];
    v_has_emp := false;
    v_parts := CASE WHEN coalesce(v_args, '') = '' THEN ARRAY[]::text[]
                    ELSE string_to_array(v_args, ', ') END;

    FOREACH v_part IN ARRAY v_parts LOOP
      v_part := regexp_replace(v_part, '^IN ', '');
      v_name := split_part(v_part, ' ', 1);
      IF v_name = 'p_employee_id' THEN
        v_has_emp := true;
        IF m.mode = 'self' THEN
          w_call := w_call || 'private.session_employee_id(p_token)'::text;
        ELSIF m.mode = 'self_or_admin' THEN
          w_sig := w_sig || v_part;
          w_call := w_call || 'private.resolve_employee(p_token, p_employee_id)'::text;
        ELSE
          w_sig := w_sig || v_part;
          w_call := w_call || v_name;
        END IF;
      ELSE
        w_sig := w_sig || v_part;
        w_call := w_call || v_name;
      END IF;
    END LOOP;

    IF m.mode IN ('self','self_or_admin') AND NOT v_has_emp THEN
      RAISE EXCEPTION '% is mode % but has no p_employee_id arg', m.fname, m.mode;
    END IF;

    v_guard := CASE m.mode
                 WHEN 'admin' THEN ' WHERE private.require_admin(p_token)'
                 WHEN 'any'   THEN ' WHERE private.require_session(p_token)'
                 ELSE '' END;

    IF v_retset THEN
      v_body := format('SELECT * FROM private.%I(%s)%s',
                       m.fname, array_to_string(w_call, ', '), v_guard);
    ELSE
      v_body := format('SELECT private.%I(%s)%s',
                       m.fname, array_to_string(w_call, ', '), v_guard);
    END IF;

    EXECUTE format(
      'CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql SECURITY DEFINER '
      'SET search_path = public, extensions AS %L',
      m.fname, array_to_string(w_sig, ', '), v_result, v_body);

    SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = m.fname;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', v_oid::regprocedure);
    RAISE NOTICE 'wrapped % (%)', m.fname, m.mode;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 7. add_user: admin only, and only Admin/Dev may create Admin/Dev
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.add_user(text,text,text,text)') IS NOT NULL THEN
    ALTER FUNCTION public.add_user(text,text,text,text) SET SCHEMA private;
    ALTER FUNCTION private.add_user(text,text,text,text) SET search_path = public, extensions;
    REVOKE EXECUTE ON FUNCTION private.add_user(text,text,text,text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.add_user(p_token text, p_employee_id text, p_email text,
                                           p_role text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_caller text := private.session_employee_id(p_token);
        v_caller_role text;
BEGIN
  SELECT role INTO v_caller_role FROM public.employees WHERE employee_id = v_caller;
  IF v_caller_role NOT IN ('Admin','HR','Dev') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_role IN ('Admin','Dev') AND v_caller_role NOT IN ('Admin','Dev') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only Admin/Dev can create Admin or Dev users');
  END IF;
  IF length(coalesce(p_password, '')) < 8 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Password must be at least 8 characters');
  END IF;
  RETURN private.add_user(p_employee_id, p_email, p_role, p_password);
END $$;
REVOKE EXECUTE ON FUNCTION public.add_user(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_user(text,text,text,text,text) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. update_user (was missing - the Edit User screen was failing)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_user(p_token text, p_employee_id text, p_email text,
                                              p_role text, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_caller text := private.session_employee_id(p_token);
        v_caller_role text;
        v_target_role text;
BEGIN
  SELECT role INTO v_caller_role FROM public.employees WHERE employee_id = v_caller;
  IF v_caller_role NOT IN ('Admin','HR','Dev') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_target_role FROM public.employees WHERE employee_id = p_employee_id;
  IF v_target_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Employee not found');
  END IF;
  IF (p_role IN ('Admin','Dev') OR v_target_role IN ('Admin','Dev'))
     AND v_caller_role NOT IN ('Admin','Dev') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only Admin/Dev can change Admin or Dev users');
  END IF;
  IF p_employee_id = v_caller AND p_role IS DISTINCT FROM v_caller_role THEN
    RETURN jsonb_build_object('success', false, 'message', 'You cannot change your own role');
  END IF;

  UPDATE public.employees
  SET email  = coalesce(p_email, email),
      role   = coalesce(p_role, role),
      status = coalesce(p_status, status)
  WHERE employee_id = p_employee_id;

  IF coalesce(p_status, 'Active') <> 'Active' THEN
    DELETE FROM private.app_sessions WHERE employee_id = p_employee_id;  -- kick them out
  END IF;

  INSERT INTO public.audit_log (employee_id, action, details)
  VALUES (p_employee_id, 'user_updated',
          jsonb_build_object('by', v_caller, 'email', p_email, 'role', p_role, 'status', p_status));
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('success', false, 'message', 'Email already exists');
END $$;
REVOKE EXECUTE ON FUNCTION public.update_user(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user(text,text,text,text,text) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.app_login(text,text), public.app_whoami(text), public.app_logout(text)
  TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. STORAGE: nobody can overwrite an existing selfie
-- ---------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'UPDATE'
      AND (coalesce(qual, '') ILIKE '%attendance-media%'
           OR coalesce(with_check, '') ILIKE '%attendance-media%')
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
    RAISE NOTICE 'dropped storage UPDATE policy %', r.policyname;
  END LOOP;
END $$;

COMMIT;

-- =====================================================================
-- STEP 2 - RUN ONLY AFTER every employee has logged in successfully
-- with Employee ID + password on the new app. Deletes the plaintext copy.
-- =====================================================================
-- UPDATE public.employees SET login_password = NULL;
