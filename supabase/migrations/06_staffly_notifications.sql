-- =====================================================================
-- STAFFLY: IN-APP NOTIFICATIONS
-- Run after staffly_backend_hardening.
-- ---------------------------------------------------------------------
-- Created automatically by triggers - no app code has to remember:
--   * Employee punches IN        -> every Admin/HR/Dev   ("Neha punched in · 10:52 AM · Late")
--                                -> the employee         ("Punch In recorded · 10:52 AM")
--   * Employee APPLIES for leave -> every Admin/HR/Dev   ("Ravi applied for Sick leave · 2 days")
--   * Leave APPROVED / REJECTED  -> the employee         ("Your Sick leave was approved")
-- Punch OUT creates no notification (by request).
-- Leave reasons are never put in notifications (privacy).
-- Notifications older than 30 days are removed automatically.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS private.notifications (
  id           bigserial PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('punch_in', 'punch_in_self', 'leave_applied', 'leave_decided')),
  title        text NOT NULL,
  body         text,
  subject_id   text,                -- employee the notification is about
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON private.notifications (recipient_id, id DESC);

-- Everyone who should hear about team events.
CREATE OR REPLACE FUNCTION private.notify_admins(p_kind text, p_title text, p_body text, p_subject text)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  INSERT INTO private.notifications (recipient_id, kind, title, body, subject_id)
  SELECT e.employee_id, p_kind, p_title, p_body, p_subject
  FROM public.employees e
  WHERE e.role IN ('Admin', 'HR', 'Dev') AND e.status = 'Active'
    AND e.employee_id IS DISTINCT FROM p_subject;   -- don't tell people about themselves
$$;

CREATE OR REPLACE FUNCTION private.display_name(p_employee_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT coalesce(nullif(trim(name), ''), employee_id) FROM public.employees WHERE employee_id = p_employee_id;
$$;

-- ---------------------------------------------------------------------
-- Punch in
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.trg_notify_punch_in()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ist   timestamp;
  v_time  text;
  v_late  boolean;
  v_name  text;
BEGIN
  -- Only the moment clock_in_time is first set (insert, or update from NULL).
  IF NEW.clock_in_time IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.clock_in_time IS NOT NULL THEN RETURN NEW; END IF;

  BEGIN
    v_ist  := NEW.clock_in_time AT TIME ZONE 'Asia/Kolkata';
    v_time := to_char(v_ist, 'HH12:MI AM');
    -- Shift starts 11:00 IST (same as the app's "Official Shift").
    v_late := coalesce(NEW.status ILIKE '%late%', false) OR v_ist::time > time '11:00';
    v_name := coalesce(private.display_name(NEW.employee_id), NEW.employee_id);

    PERFORM private.notify_admins(
      'punch_in',
      v_name || ' punched in',
      v_time || CASE WHEN v_late THEN ' · Late' ELSE '' END,
      NEW.employee_id);

    INSERT INTO private.notifications (recipient_id, kind, title, body, subject_id)
    VALUES (NEW.employee_id, 'punch_in_self', 'Punch In recorded', v_time, NEW.employee_id);
  EXCEPTION WHEN OTHERS THEN
    -- A notification problem must never block a punch.
    RAISE WARNING 'punch-in notification skipped: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_punch_in ON public.attendance;
CREATE TRIGGER notify_punch_in
  AFTER INSERT OR UPDATE OF clock_in_time ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION private.trg_notify_punch_in();

-- ---------------------------------------------------------------------
-- Leave applied / decided
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.trg_notify_leave()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_days int;
  v_name text;
  v_type text;
  v_when text;
BEGIN
  BEGIN
    v_type := coalesce(nullif(trim(NEW.leave_type), ''), 'leave');
    v_days := greatest((NEW.to_date - NEW.from_date) + 1, 1);
    v_when := CASE WHEN NEW.from_date = NEW.to_date
                   THEN to_char(NEW.from_date, 'DD Mon')
                   ELSE to_char(NEW.from_date, 'DD Mon') || ' – ' || to_char(NEW.to_date, 'DD Mon') END;

    IF TG_OP = 'INSERT' THEN
      v_name := coalesce(private.display_name(NEW.employee_id), NEW.employee_id);
      PERFORM private.notify_admins(
        'leave_applied',
        v_name || ' applied for ' || v_type || ' leave',
        v_when || ' · ' || v_days || CASE WHEN v_days = 1 THEN ' day' ELSE ' days' END,
        NEW.employee_id);

    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('Approved', 'Rejected') THEN
      INSERT INTO private.notifications (recipient_id, kind, title, body, subject_id)
      VALUES (NEW.employee_id, 'leave_decided',
              'Your ' || v_type || ' leave was ' || lower(NEW.status),
              v_when || CASE WHEN coalesce(nullif(trim(NEW.hr_comment), ''), NEW.status) <> NEW.status
                             THEN ' · "' || left(NEW.hr_comment, 80) || '"' ELSE '' END,
              NEW.employee_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'leave notification skipped: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_leave ON public.leaves;
CREATE TRIGGER notify_leave
  AFTER INSERT OR UPDATE OF status ON public.leaves
  FOR EACH ROW EXECUTE FUNCTION private.trg_notify_leave();

-- ---------------------------------------------------------------------
-- App API (token-checked, like everything else)
-- ---------------------------------------------------------------------
-- Newest notifications for the caller + unread count.
-- p_after_id > 0 returns only newer ones (cheap polling).
CREATE OR REPLACE FUNCTION public.app_notifications(p_token text, p_after_id bigint DEFAULT 0, p_limit int DEFAULT 30)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_emp text := private.session_employee_id(p_token);
BEGIN
  -- Housekeeping: keep 30 days.
  DELETE FROM private.notifications
  WHERE recipient_id = v_emp AND created_at < now() - interval '30 days';

  RETURN json_build_object(
    'unread', (SELECT count(*) FROM private.notifications WHERE recipient_id = v_emp AND read_at IS NULL),
    'items', coalesce((
      SELECT json_agg(x ORDER BY x.id DESC) FROM (
        SELECT id, kind, title, body, subject_id, created_at, read_at IS NOT NULL AS read
        FROM private.notifications
        WHERE recipient_id = v_emp AND id > coalesce(p_after_id, 0)
        ORDER BY id DESC
        LIMIT least(greatest(coalesce(p_limit, 30), 1), 100)
      ) x), '[]'::json));
END $$;

-- Mark some (p_ids) or all (NULL) of the caller's notifications as read.
CREATE OR REPLACE FUNCTION public.app_notifications_read(p_token text, p_ids bigint[] DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp text := private.session_employee_id(p_token);
  v_n   int;
BEGIN
  UPDATE private.notifications SET read_at = now()
  WHERE recipient_id = v_emp AND read_at IS NULL
    AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN json_build_object('success', true, 'marked', v_n);
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_notifications(text, bigint, int),
                          public.app_notifications_read(text, bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_notifications(text, bigint, int),
                         public.app_notifications_read(text, bigint[]) TO anon, authenticated;

COMMIT;
