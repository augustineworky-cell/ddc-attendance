-- =====================================================================
-- STAFFLY: OFFICE WI-FI CHECK   (run AFTER staffly_security_fix)
-- ---------------------------------------------------------------------
-- If a phone is on the office internet connection (matched by public IP),
-- Punch In / Punch Out are accepted even when the phone's GPS is weak or
-- says "far away". GPS is still tried first; Wi-Fi is the fallback.
--
-- Every Wi-Fi-verified punch is written to audit_log with the phone's real
-- GPS reading and IP, so HR can always see how a punch was verified.
--
-- Office networks are managed from the app (Admin/HR/Dev):
--   "Add this network" while connected to office Wi-Fi.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS private.office_networks (
  id         bigserial PRIMARY KEY,
  network    cidr NOT NULL UNIQUE,         -- single IP stored as /32
  label      text NOT NULL,
  added_by   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Office HQ point used when a punch is verified by Wi-Fi instead of GPS.
-- Must match OFFICE_LAT / OFFICE_LNG in app.js.
CREATE OR REPLACE FUNCTION private.office_point()
RETURNS TABLE(lat double precision, lng double precision)
LANGUAGE sql IMMUTABLE AS $$ SELECT 28.56616::float8, 77.19904::float8 $$;

-- The caller's public IP, as seen by Supabase's edge.
-- cf-connecting-ip is set by Cloudflare in front of the Supabase API and
-- overwrites anything the client sends. We deliberately do NOT trust the
-- first entry of x-forwarded-for, which a client can fake.
CREATE OR REPLACE FUNCTION private.request_ip()
RETURNS inet LANGUAGE plpgsql STABLE AS $$
DECLARE
  h   json;
  v   text;
BEGIN
  BEGIN
    h := current_setting('request.headers', true)::json;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF h IS NULL THEN RETURN NULL; END IF;
  v := nullif(trim(h->>'cf-connecting-ip'), '');
  IF v IS NULL THEN RETURN NULL; END IF;
  BEGIN
    RETURN v::inet;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END $$;

CREATE OR REPLACE FUNCTION private.is_office_ip(p_ip inet)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT p_ip IS NOT NULL
     AND EXISTS (SELECT 1 FROM private.office_networks n WHERE p_ip <<= n.network);
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Employee: am I on office Wi-Fi right now?  (drives the home card)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_network_check(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_ip inet;
BEGIN
  PERFORM private.session_employee_id(p_token);
  v_ip := private.request_ip();
  RETURN json_build_object(
    'on_office_network', private.is_office_ip(v_ip),
    'ip_detected', v_ip IS NOT NULL);
END $$;

-- ---------------------------------------------------------------------
-- Admin: manage office networks
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_office_networks(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_ip inet;
BEGIN
  PERFORM private.require_admin(p_token);
  v_ip := private.request_ip();
  RETURN json_build_object(
    'your_ip', host(v_ip),
    'you_are_on_office_network', private.is_office_ip(v_ip),
    'headers_seen', (SELECT json_build_object(
        'cf-connecting-ip', h->>'cf-connecting-ip',
        'x-real-ip', h->>'x-real-ip',
        'x-forwarded-for', h->>'x-forwarded-for')
      FROM (SELECT current_setting('request.headers', true)::json AS h) x),
    'networks', coalesce((
      SELECT json_agg(json_build_object('id', id, 'network', network::text, 'label', label,
                                        'added_by', added_by, 'created_at', created_at)
                      ORDER BY created_at)
      FROM private.office_networks), '[]'::json));
END $$;

-- Adds the network the admin is connected to RIGHT NOW (no typing IPs).
CREATE OR REPLACE FUNCTION public.admin_add_current_network(p_token text, p_label text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_admin text := private.session_employee_id(p_token);
  v_ip inet;
BEGIN
  PERFORM private.require_admin(p_token);
  v_ip := private.request_ip();
  IF v_ip IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Could not detect your IP address.');
  END IF;
  IF private.is_office_ip(v_ip) THEN
    RETURN json_build_object('success', false, 'message', 'This network is already saved.');
  END IF;
  INSERT INTO private.office_networks (network, label, added_by)
  VALUES (set_masklen(v_ip::cidr, CASE WHEN family(v_ip) = 4 THEN 32 ELSE 128 END),
          coalesce(nullif(trim(p_label), ''), 'Office Wi-Fi'), v_admin);
  INSERT INTO public.audit_log (employee_id, action, details)
  VALUES (v_admin, 'office_network_added', jsonb_build_object('ip', host(v_ip), 'label', p_label));
  RETURN json_build_object('success', true, 'ip', host(v_ip));
END $$;

CREATE OR REPLACE FUNCTION public.admin_remove_office_network(p_token text, p_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_admin text := private.session_employee_id(p_token);
  v_net text;
BEGIN
  PERFORM private.require_admin(p_token);
  DELETE FROM private.office_networks WHERE id = p_id RETURNING network::text INTO v_net;
  IF v_net IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Network not found');
  END IF;
  INSERT INTO public.audit_log (employee_id, action, details)
  VALUES (v_admin, 'office_network_removed', jsonb_build_object('network', v_net));
  RETURN json_build_object('success', true);
END $$;

-- ---------------------------------------------------------------------
-- Rebuild clock_in / clock_out wrappers with the Wi-Fi fallback.
-- Signature and return type are read from the live wrappers so the
-- frontend call stays exactly the same.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  f        text;
  v_oid    oid;
  v_args   text;
  v_result text;
  v_body   text;
  v_ltype  text;
BEGIN
  FOREACH f IN ARRAY ARRAY['clock_in', 'clock_out'] LOOP
    SELECT p.oid, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
      INTO v_oid, v_args, v_result
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = f;

    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'public.% wrapper not found - run staffly_security_fix first', f;
    END IF;
    IF v_args NOT LIKE 'p_token text, p_lat %, p_lng %, p_accuracy %' THEN
      RAISE EXCEPTION 'public.% has unexpected args: %', f, v_args;
    END IF;
    v_ltype := substring(v_args from 'p_lat ([^,]+),');
    IF v_result NOT IN ('json', 'jsonb') THEN
      RAISE EXCEPTION 'public.% returns %, expected json/jsonb', f, v_result;
    END IF;

    v_body := format($b$
DECLARE
  v_emp    text := private.session_employee_id(p_token);
  v_ip     inet := private.request_ip();
  v_office boolean := private.is_office_ip(v_ip);
  v_res    %1$s;
  v_hq     record;
BEGIN
  -- 1. Normal GPS check first.
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_res := private.%2$I(v_emp, p_lat, p_lng, p_accuracy);
    IF NOT v_office OR coalesce(v_res->>'status', '') <> 'OUT_OF_RANGE' THEN
      RETURN v_res;
    END IF;
  END IF;

  -- 2. GPS missing or "far away", but phone is on office Wi-Fi.
  IF v_office THEN
    SELECT * INTO v_hq FROM private.office_point();
    v_res := private.%2$I(v_emp, v_hq.lat::%3$s, v_hq.lng::%3$s, 0);
    INSERT INTO public.audit_log (employee_id, action, details)
    VALUES (v_emp, '%2$s_via_office_wifi', jsonb_build_object(
      'ip', host(v_ip), 'status', v_res->>'status',
      'gps_lat', p_lat, 'gps_lng', p_lng, 'gps_accuracy', p_accuracy));
    RETURN (v_res::jsonb || jsonb_build_object('verified_by', 'office_wifi'))::%1$s;
  END IF;

  -- 3. No GPS and not on office Wi-Fi.
  RETURN json_build_object('status', 'NO_LOCATION')::%1$s;
END
$b$, v_result, f, v_ltype);

    EXECUTE format('DROP FUNCTION %s', v_oid::regprocedure);
    EXECUTE format(
      'CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER '
      'SET search_path = public, extensions AS %L',
      f, v_args, v_result, v_body);

    SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = f;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', v_oid::regprocedure);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.app_network_check(text),
  public.admin_list_office_networks(text),
  public.admin_add_current_network(text, text),
  public.admin_remove_office_network(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_network_check(text),
  public.admin_list_office_networks(text),
  public.admin_add_current_network(text, text),
  public.admin_remove_office_network(text, bigint) TO anon, authenticated;

COMMIT;

-- =====================================================================
-- VERIFY (run after applying): shows exactly which IP headers Supabase
-- receives. cf-connecting-ip must be present for the Wi-Fi check to work.
-- Call from the app's browser console while logged in as Admin:
--   sbClient.rpc('admin_list_office_networks', {p_token: CURRENT_USER.token}).then(console.log)
-- =====================================================================
