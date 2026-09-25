-- =====================================================================
-- STAFFLY: PUSH NOTIFICATIONS  (alerts when the app is closed)
-- Run AFTER staffly_notifications.
-- ---------------------------------------------------------------------
-- * Each device that taps "Enable phone alerts" saves its browser push
--   subscription here (token-checked, tied to the logged-in employee).
-- * Every new row in private.notifications calls the Edge Function
--   "staffly-push" (via pg_net) with only the notification id.
-- * The Edge Function CLAIMS the notification (one time only) and pushes it
--   to the recipient's devices. A claimed or old id can never be re-sent,
--   so the function needs no shared secret and can't be used to spam.
-- * Nothing here can ever block a punch or a leave action.
-- =====================================================================

BEGIN;

-- Where the Edge Function lives (one row, easy to change later).
CREATE TABLE IF NOT EXISTS private.app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO private.app_config (key, value)
VALUES ('push_function_url', 'https://bpwpxhsdmbkymhpjsfej.supabase.co/functions/v1/staffly-push')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.push_subscriptions (
  id              bigserial PRIMARY KEY,
  employee_id     text NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failures        int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_emp_idx ON private.push_subscriptions (employee_id);

ALTER TABLE private.notifications ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

-- ---------------------------------------------------------------------
-- App API
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_push_subscribe(
  p_token text, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_emp text := private.session_employee_id(p_token);
BEGIN
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://' OR length(p_endpoint) > 1000
     OR coalesce(p_p256dh, '') = '' OR coalesce(p_auth, '') = '' THEN
    RETURN json_build_object('success', false, 'message', 'Invalid subscription');
  END IF;
  -- Same device, new person (shared phone): the device follows whoever logged in.
  INSERT INTO private.push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_emp, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  ON CONFLICT (endpoint) DO UPDATE
    SET employee_id = EXCLUDED.employee_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent, failures = 0;
  -- Keep at most 5 devices per person.
  DELETE FROM private.push_subscriptions
  WHERE employee_id = v_emp
    AND id NOT IN (SELECT id FROM private.push_subscriptions WHERE employee_id = v_emp
                   ORDER BY created_at DESC LIMIT 5);
  RETURN json_build_object('success', true);
END $$;

CREATE OR REPLACE FUNCTION public.app_push_unsubscribe(p_token text, p_endpoint text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_emp text := private.session_employee_id(p_token);
BEGIN
  DELETE FROM private.push_subscriptions WHERE employee_id = v_emp AND endpoint = p_endpoint;
  RETURN json_build_object('success', true);
END $$;

-- ---------------------------------------------------------------------
-- Edge Function API (service role only)
-- ---------------------------------------------------------------------
-- Claim a notification for pushing. Returns NULL if unknown, already pushed,
-- or older than 10 minutes.
CREATE OR REPLACE FUNCTION public.svc_push_claim(p_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE n private.notifications;
BEGIN
  UPDATE private.notifications SET pushed_at = now()
  WHERE id = p_id AND pushed_at IS NULL AND created_at > now() - interval '10 minutes'
  RETURNING * INTO n;
  IF n.id IS NULL THEN RETURN NULL; END IF;
  RETURN json_build_object(
    'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
    'subscriptions', coalesce((
      SELECT json_agg(json_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
      FROM private.push_subscriptions s
      JOIN public.employees e ON e.employee_id = s.employee_id AND e.status = 'Active'
      WHERE s.employee_id = n.recipient_id), '[]'::json));
END $$;

-- Record the result for one device; dead devices (404/410) are removed.
CREATE OR REPLACE FUNCTION public.svc_push_result(p_endpoint text, p_ok boolean, p_gone boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF p_gone THEN
    DELETE FROM private.push_subscriptions WHERE endpoint = p_endpoint;
  ELSIF p_ok THEN
    UPDATE private.push_subscriptions SET last_success_at = now(), failures = 0 WHERE endpoint = p_endpoint;
  ELSE
    UPDATE private.push_subscriptions SET failures = failures + 1 WHERE endpoint = p_endpoint;
    DELETE FROM private.push_subscriptions WHERE endpoint = p_endpoint AND failures >= 10;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Trigger: every new notification -> ask the Edge Function to push it
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.trg_push_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_url text;
BEGIN
  BEGIN
    -- Skip quietly if the person has no device with alerts enabled.
    IF NOT EXISTS (SELECT 1 FROM private.push_subscriptions WHERE employee_id = NEW.recipient_id) THEN
      RETURN NEW;
    END IF;
    SELECT value INTO v_url FROM private.app_config WHERE key = 'push_function_url';
    IF v_url IS NULL THEN RETURN NEW; END IF;
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object('action', 'send', 'notification_id', NEW.id),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 5000);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push request skipped: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS push_notification ON private.notifications;
CREATE TRIGGER push_notification
  AFTER INSERT ON private.notifications
  FOR EACH ROW EXECUTE FUNCTION private.trg_push_notification();

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.app_push_subscribe(text, text, text, text, text),
                          public.app_push_unsubscribe(text, text),
                          public.svc_push_claim(bigint),
                          public.svc_push_result(text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_push_subscribe(text, text, text, text, text),
                         public.app_push_unsubscribe(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.svc_push_claim(bigint),
                         public.svc_push_result(text, boolean, boolean) TO service_role;

COMMIT;
