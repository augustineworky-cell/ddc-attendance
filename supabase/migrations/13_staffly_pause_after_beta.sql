-- =====================================================================
-- STAFFLY: PAUSE AFTER BETA  ("Testing phase completed")
-- ---------------------------------------------------------------------
-- From pause_from (12:00 AM IST, 7 Oct 2026) until you resume:
--   * Password, PIN and fingerprint logins are refused  -> APP_PAUSED
--   * Anyone still logged in is signed out on their next action
--   * Punch In / Out, leave, everything that needs a session: refused
--   * Daily punch reminders are skipped
--   * public.app_status() tells the app to show the "Testing phase
--     completed - wait for the final launch" screen (no login needed)
-- Exception: the Dev role (EMP101) can still log in to prepare launch.
-- No data is deleted. Today's punches (before midnight) work normally.
--
-- RESUME (final launch) - run this one line:
--   UPDATE private.app_config SET value = '' WHERE key = 'pause_from';
-- =====================================================================
BEGIN;

INSERT INTO private.app_config (key, value) VALUES
  ('pause_from', '2026-10-07 00:00:00+05:30'),
  ('pause_message', 'Testing phase completed. Please wait for the final launch.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION private.app_is_paused()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT coalesce((
    SELECT now() >= value::timestamptz FROM private.app_config
    WHERE key = 'pause_from' AND coalesce(value, '') <> ''), false);
$$;

CREATE OR REPLACE FUNCTION private.pause_message()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT coalesce((SELECT nullif(value, '') FROM private.app_config WHERE key = 'pause_message'),
                  'Testing phase completed. Please wait for the final launch.');
$$;

-- Paused for this person? (Dev keeps access.)
CREATE OR REPLACE FUNCTION private.paused_for(p_employee_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT private.app_is_paused() AND NOT EXISTS (
    SELECT 1 FROM public.employees
    WHERE lower(employee_id) = lower(coalesce(p_employee_id, '')) AND role = 'Dev');
$$;

REVOKE ALL ON FUNCTION private.app_is_paused(), private.pause_message(), private.paused_for(text)
  FROM PUBLIC, anon, authenticated;

-- App asks before showing the login form (no token needed).
CREATE OR REPLACE FUNCTION public.app_status()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT json_build_object('paused', private.app_is_paused(), 'message', private.pause_message());
$$;
REVOKE EXECUTE ON FUNCTION public.app_status() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.app_status() TO anon, authenticated;

-- 1. Every action that needs a session: refuse + sign out while paused.
--    Message keeps "SESSION_INVALID" so older app versions also sign out.
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
  IF private.paused_for(v_emp) THEN
    RAISE EXCEPTION 'SESSION_INVALID APP_PAUSED' USING ERRCODE = '28000';
  END IF;
  RETURN v_emp;
END $$;

-- 2. Password login
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

  -- Paused: same answer whether or not the ID exists (Dev excepted).
  IF private.paused_for(v_key) THEN
    RETURN json_build_object('status', 'APP_PAUSED', 'message', private.pause_message());
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

-- 3. PIN / fingerprint logins go through create_session
CREATE OR REPLACE FUNCTION private.create_session(p_employee_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp   record;
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_exp   timestamptz := now() + interval '16 hours';
BEGIN
  IF private.paused_for(p_employee_id) THEN
    RETURN json_build_object('status', 'APP_PAUSED', 'message', private.pause_message());
  END IF;
  SELECT employee_id, name, role INTO v_emp
  FROM public.employees WHERE employee_id = p_employee_id AND status = 'Active';
  IF v_emp.employee_id IS NULL THEN
    RETURN json_build_object('status', 'INACTIVE');
  END IF;
  DELETE FROM private.app_sessions WHERE expires_at < now();
  INSERT INTO private.app_sessions (token_hash, employee_id, expires_at)
  VALUES (digest(v_token, 'sha256'), v_emp.employee_id, v_exp);
  RETURN json_build_object(
    'status', 'SUCCESS', 'token', v_token, 'expires_at', v_exp,
    'employee_id', v_emp.employee_id, 'employee_name', v_emp.name, 'role', v_emp.role);
END $$;

-- 4. Safety net: no new session can be created for a paused user by ANY path.
CREATE OR REPLACE FUNCTION private.trg_block_session_when_paused()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF private.paused_for(NEW.employee_id) THEN
    RAISE EXCEPTION 'APP_PAUSED' USING ERRCODE = '28000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS block_session_when_paused ON private.app_sessions;
CREATE TRIGGER block_session_when_paused BEFORE INSERT ON private.app_sessions
  FOR EACH ROW EXECUTE FUNCTION private.trg_block_session_when_paused();

COMMIT;

-- 5. Skip punch reminders while paused (keeps working again after resume)
SELECT cron.alter_job(jobid, command := $$SELECT private.send_punch_reminders('in') WHERE NOT private.app_is_paused()$$)
FROM cron.job WHERE jobname = 'staffly-reminder-in';
SELECT cron.alter_job(jobid, command := $$SELECT private.send_punch_reminders('out') WHERE NOT private.app_is_paused()$$)
FROM cron.job WHERE jobname = 'staffly-reminder-out';
