-- =====================================================================
-- STAFFLY: QUICK LOGIN (4-digit PIN + fingerprint)
-- Run AFTER staffly_security_fix.
-- ---------------------------------------------------------------------
-- * After a normal ID+password login, a phone is REGISTERED to that
--   employee: the phone gets a random device secret (only its hash is
--   stored here) and the employee sets a 4-digit PIN (bcrypt-hashed).
-- * PIN login works ONLY together with that phone's device secret, so a
--   PIN is useless on any other phone. 5 wrong PINs = PIN locked, employee
--   must use ID+password and set a new PIN.
-- * Fingerprint = WebAuthn passkey. The fingerprint never leaves the phone;
--   we store only the passkey's PUBLIC key. Signature checks happen in the
--   Edge Function "staffly-passkey", which calls the svc_* functions below
--   with the service role (anon can't call them).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Tables (private schema = not reachable through the API)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   text NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  secret_hash   bytea NOT NULL UNIQUE,
  pin_hash      text NOT NULL,
  pin_failed    int  NOT NULL DEFAULT 0,
  label         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS devices_emp_idx ON private.devices(employee_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS private.passkeys (
  credential_id text PRIMARY KEY,              -- base64url
  employee_id   text NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  device_id     uuid NOT NULL REFERENCES private.devices(id) ON DELETE CASCADE,
  public_key    text NOT NULL,                 -- base64url COSE public key
  sign_count    bigint NOT NULL DEFAULT 0,
  transports    text[],
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX IF NOT EXISTS passkeys_device_idx ON private.passkeys(device_id);

CREATE TABLE IF NOT EXISTS private.webauthn_challenges (
  challenge   text PRIMARY KEY,
  purpose     text NOT NULL CHECK (purpose IN ('register','login')),
  employee_id text NOT NULL,
  device_id   uuid NOT NULL,
  expires_at  timestamptz NOT NULL
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.create_session(p_employee_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp   record;
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_exp   timestamptz := now() + interval '16 hours';
BEGIN
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

-- Active device for a secret (employee must be Active).
CREATE OR REPLACE FUNCTION private.device_for_secret(p_secret text)
RETURNS private.devices LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT d.* FROM private.devices d
  JOIN public.employees e ON e.employee_id = d.employee_id
  WHERE p_secret IS NOT NULL AND length(p_secret) >= 32
    AND d.secret_hash = digest(p_secret, 'sha256')
    AND d.revoked_at IS NULL
    AND e.status = 'Active';
$$;

CREATE OR REPLACE FUNCTION private.pin_is_weak(p_pin text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_pin ~ '^(\d)\1{3}$'                       -- 0000, 1111 ...
      OR p_pin IN ('1234','2345','3456','4567','5678','6789','0123',
                   '9876','8765','7654','6543','5432','4321','3210',
                   '1212','1122','2580','0852');
$$;

-- ---------------------------------------------------------------------
-- 1. Register this phone + set PIN (needs a normal login token)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_register_device(p_token text, p_pin text, p_label text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp    text := private.session_employee_id(p_token);
  v_secret text := encode(gen_random_bytes(32), 'hex');
  v_id     uuid;
  v_name   text;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RETURN json_build_object('status', 'INVALID_PIN_FORMAT', 'message', 'PIN must be exactly 4 digits.');
  END IF;
  IF private.pin_is_weak(p_pin) THEN
    RETURN json_build_object('status', 'WEAK_PIN', 'message', 'That PIN is too easy to guess. Choose a different one.');
  END IF;

  INSERT INTO private.devices (employee_id, secret_hash, pin_hash, label)
  VALUES (v_emp, digest(v_secret, 'sha256'), crypt(p_pin, gen_salt('bf')), left(p_label, 80))
  RETURNING id INTO v_id;

  -- Keep at most 3 active phones per employee (oldest revoked first).
  UPDATE private.devices SET revoked_at = now()
  WHERE employee_id = v_emp AND revoked_at IS NULL
    AND id NOT IN (SELECT id FROM private.devices
                   WHERE employee_id = v_emp AND revoked_at IS NULL
                   ORDER BY created_at DESC LIMIT 3);

  SELECT name INTO v_name FROM public.employees WHERE employee_id = v_emp;
  INSERT INTO public.audit_log (employee_id, action, details)
  VALUES (v_emp, 'quick_login_device_registered', jsonb_build_object('device_id', v_id, 'label', left(p_label, 80)));

  RETURN json_build_object('status', 'SUCCESS', 'device_secret', v_secret,
                           'employee_id', v_emp, 'employee_name', v_name);
END $$;

-- ---------------------------------------------------------------------
-- 2. Who is this phone registered to? (for "Welcome back, Ravi")
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_device_info(p_device_secret text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  d      private.devices;
  v_name text;
BEGIN
  d := private.device_for_secret(p_device_secret);
  IF d.id IS NULL THEN
    RETURN json_build_object('status', 'INVALID');
  END IF;
  SELECT name INTO v_name FROM public.employees WHERE employee_id = d.employee_id;
  RETURN json_build_object(
    'status', 'OK',
    'employee_id', d.employee_id,
    'employee_name', v_name,
    'has_fingerprint', EXISTS (SELECT 1 FROM private.passkeys p WHERE p.device_id = d.id),
    'pin_locked', d.pin_failed >= 5);
END $$;

-- ---------------------------------------------------------------------
-- 3. PIN login (phone secret + PIN)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_login_pin(p_device_secret text, p_pin text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  d      private.devices;
  v_left int;
BEGIN
  d := private.device_for_secret(p_device_secret);
  IF d.id IS NULL THEN
    RETURN json_build_object('status', 'INVALID_DEVICE');
  END IF;
  IF d.pin_failed >= 5 THEN
    RETURN json_build_object('status', 'PIN_LOCKED');
  END IF;

  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' OR d.pin_hash <> crypt(p_pin, d.pin_hash) THEN
    UPDATE private.devices SET pin_failed = pin_failed + 1 WHERE id = d.id
    RETURNING 5 - pin_failed INTO v_left;
    IF v_left <= 0 THEN
      INSERT INTO public.audit_log (employee_id, action, details)
      VALUES (d.employee_id, 'quick_login_pin_locked', jsonb_build_object('device_id', d.id));
      RETURN json_build_object('status', 'PIN_LOCKED');
    END IF;
    RETURN json_build_object('status', 'INVALID_PIN', 'attempts_left', v_left);
  END IF;

  UPDATE private.devices SET pin_failed = 0, last_used_at = now() WHERE id = d.id;
  RETURN private.create_session(d.employee_id);
END $$;

-- ---------------------------------------------------------------------
-- 4. Admin: reset an employee's quick login (lost/new phone, forgot PIN)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reset_quick_login(p_token text, p_employee_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_admin text := private.session_employee_id(p_token);
  v_count int;
BEGIN
  PERFORM private.require_admin(p_token);
  UPDATE private.devices SET revoked_at = now()
  WHERE lower(employee_id) = lower(trim(p_employee_id)) AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM private.passkeys WHERE lower(employee_id) = lower(trim(p_employee_id));
  INSERT INTO public.audit_log (employee_id, action, details)
  VALUES (p_employee_id, 'quick_login_reset', jsonb_build_object('by', v_admin, 'devices_revoked', v_count));
  RETURN json_build_object('success', true, 'devices_revoked', v_count);
END $$;

-- ---------------------------------------------------------------------
-- 5. Fingerprint (WebAuthn) - called ONLY by the Edge Function
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.svc_passkey_register_begin(p_token text, p_device_secret text, p_challenge text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp  text := private.session_employee_id(p_token);
  d      private.devices;
  v_name text;
BEGIN
  d := private.device_for_secret(p_device_secret);
  IF d.id IS NULL OR d.employee_id <> v_emp THEN
    RAISE EXCEPTION 'DEVICE_MISMATCH' USING ERRCODE = '42501';
  END IF;
  DELETE FROM private.webauthn_challenges WHERE expires_at < now();
  INSERT INTO private.webauthn_challenges (challenge, purpose, employee_id, device_id, expires_at)
  VALUES (p_challenge, 'register', v_emp, d.id, now() + interval '5 minutes');
  SELECT name INTO v_name FROM public.employees WHERE employee_id = v_emp;
  RETURN json_build_object(
    'employee_id', v_emp, 'employee_name', v_name,
    'exclude', coalesce((SELECT json_agg(json_build_object('id', credential_id, 'transports', transports))
                         FROM private.passkeys WHERE device_id = d.id), '[]'::json));
END $$;

-- Look up a pending challenge (not consumed yet).
CREATE OR REPLACE FUNCTION public.svc_passkey_challenge(p_challenge text, p_purpose text)
RETURNS json LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT json_build_object('employee_id', employee_id, 'device_id', device_id)
  FROM private.webauthn_challenges
  WHERE challenge = p_challenge AND purpose = p_purpose AND expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.svc_passkey_register_finish(
  p_challenge text, p_credential_id text, p_public_key text, p_sign_count bigint, p_transports text[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE c private.webauthn_challenges;
BEGIN
  DELETE FROM private.webauthn_challenges
  WHERE challenge = p_challenge AND purpose = 'register' AND expires_at > now()
  RETURNING * INTO c;
  IF c.challenge IS NULL THEN
    RAISE EXCEPTION 'CHALLENGE_INVALID' USING ERRCODE = '28000';
  END IF;
  -- One fingerprint key per phone: replace any older one on this device.
  DELETE FROM private.passkeys WHERE device_id = c.device_id;
  INSERT INTO private.passkeys (credential_id, employee_id, device_id, public_key, sign_count, transports)
  VALUES (p_credential_id, c.employee_id, c.device_id, p_public_key, coalesce(p_sign_count, 0), p_transports);
  INSERT INTO public.audit_log (employee_id, action, details)
  VALUES (c.employee_id, 'quick_login_fingerprint_enabled', jsonb_build_object('device_id', c.device_id));
  RETURN json_build_object('success', true);
END $$;

CREATE OR REPLACE FUNCTION public.svc_passkey_login_begin(p_device_secret text, p_challenge text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  d       private.devices;
  v_allow json;
BEGIN
  d := private.device_for_secret(p_device_secret);
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'INVALID_DEVICE' USING ERRCODE = '28000';
  END IF;
  SELECT json_agg(json_build_object('id', credential_id, 'transports', transports))
    INTO v_allow FROM private.passkeys WHERE device_id = d.id;
  IF v_allow IS NULL THEN
    RAISE EXCEPTION 'NO_FINGERPRINT' USING ERRCODE = '28000';
  END IF;
  DELETE FROM private.webauthn_challenges WHERE expires_at < now();
  INSERT INTO private.webauthn_challenges (challenge, purpose, employee_id, device_id, expires_at)
  VALUES (p_challenge, 'login', d.employee_id, d.id, now() + interval '5 minutes');
  RETURN json_build_object('allow', v_allow);
END $$;

-- Public key for a credential, only if it belongs to the challenge's phone.
CREATE OR REPLACE FUNCTION public.svc_passkey_login_lookup(p_challenge text, p_credential_id text)
RETURNS json LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT json_build_object('public_key', p.public_key, 'sign_count', p.sign_count, 'transports', p.transports)
  FROM private.webauthn_challenges c
  JOIN private.passkeys p ON p.device_id = c.device_id AND p.credential_id = p_credential_id
  WHERE c.challenge = p_challenge AND c.purpose = 'login' AND c.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.svc_passkey_login_finish(p_challenge text, p_credential_id text, p_new_count bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE c private.webauthn_challenges;
BEGIN
  DELETE FROM private.webauthn_challenges
  WHERE challenge = p_challenge AND purpose = 'login' AND expires_at > now()
  RETURNING * INTO c;
  IF c.challenge IS NULL THEN
    RAISE EXCEPTION 'CHALLENGE_INVALID' USING ERRCODE = '28000';
  END IF;
  UPDATE private.passkeys SET sign_count = greatest(sign_count, coalesce(p_new_count, 0)), last_used_at = now()
  WHERE credential_id = p_credential_id AND device_id = c.device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDENTIAL_MISMATCH' USING ERRCODE = '28000';
  END IF;
  UPDATE private.devices SET last_used_at = now(), pin_failed = 0 WHERE id = c.device_id;
  RETURN private.create_session(c.employee_id);
END $$;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.app_register_device(text, text, text),
  public.app_device_info(text),
  public.app_login_pin(text, text),
  public.admin_reset_quick_login(text, text),
  public.svc_passkey_register_begin(text, text, text),
  public.svc_passkey_challenge(text, text),
  public.svc_passkey_register_finish(text, text, text, bigint, text[]),
  public.svc_passkey_login_begin(text, text),
  public.svc_passkey_login_lookup(text, text),
  public.svc_passkey_login_finish(text, text, bigint)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.app_register_device(text, text, text),
  public.app_device_info(text),
  public.app_login_pin(text, text),
  public.admin_reset_quick_login(text, text)
TO anon, authenticated;

-- Fingerprint internals: Edge Function (service role) only.
GRANT EXECUTE ON FUNCTION
  public.svc_passkey_register_begin(text, text, text),
  public.svc_passkey_challenge(text, text),
  public.svc_passkey_register_finish(text, text, text, bigint, text[]),
  public.svc_passkey_login_begin(text, text),
  public.svc_passkey_login_lookup(text, text),
  public.svc_passkey_login_finish(text, text, bigint)
TO service_role;

COMMIT;
