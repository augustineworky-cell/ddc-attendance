-- =====================================================================
-- STAFFLY: PUNCH REMINDERS
-- Run AFTER staffly_push.
-- ---------------------------------------------------------------------
--  11:00 AM IST  "Don't forget to punch in"   -> Active employees with no
--                                                punch-in today and no
--                                                approved leave today
--  07:45 PM IST  "Don't forget to punch out"  -> punched in today, not out
-- Monday-Saturday only. Each person gets each reminder at most once a day.
-- Reminders are normal notifications, so they reach the bell AND (through
-- the existing trigger) phone alerts.
-- =====================================================================

BEGIN;

-- Allow the two new kinds.
ALTER TABLE private.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE private.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('punch_in', 'punch_in_self', 'leave_applied', 'leave_decided',
                  'reminder_in', 'reminder_out'));

CREATE OR REPLACE FUNCTION private.send_punch_reminders(p_type text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_kind  text := CASE p_type WHEN 'in' THEN 'reminder_in' WHEN 'out' THEN 'reminder_out' END;
  v_count int := 0;
BEGIN
  IF v_kind IS NULL THEN RAISE EXCEPTION 'p_type must be in or out'; END IF;
  -- Sunday off.
  IF extract(isodow FROM v_today) = 7 THEN RETURN 0; END IF;

  IF p_type = 'in' THEN
    INSERT INTO private.notifications (recipient_id, kind, title, body, subject_id)
    SELECT e.employee_id, 'reminder_in', 'Don''t forget to punch in',
           'Your shift started at 11:00 AM. Open Staffly to punch in.', e.employee_id
    FROM public.employees e
    WHERE e.status = 'Active'
      AND NOT EXISTS (SELECT 1 FROM public.attendance a
                      WHERE a.employee_id = e.employee_id AND a.work_date = v_today
                        AND a.clock_in_time IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.leaves l
                      WHERE l.employee_id = e.employee_id AND l.status = 'Approved'
                        AND v_today BETWEEN l.from_date AND l.to_date)
      AND NOT EXISTS (SELECT 1 FROM private.notifications n
                      WHERE n.recipient_id = e.employee_id AND n.kind = 'reminder_in'
                        AND (n.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_today);
  ELSE
    INSERT INTO private.notifications (recipient_id, kind, title, body, subject_id)
    SELECT a.employee_id, 'reminder_out', 'Don''t forget to punch out',
           'You punched in at ' || to_char(a.clock_in_time AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM')
             || '. Punch out before you leave so today counts fully.', a.employee_id
    FROM public.attendance a
    JOIN public.employees e ON e.employee_id = a.employee_id AND e.status = 'Active'
    WHERE a.work_date = v_today
      AND a.clock_in_time IS NOT NULL AND a.clock_out_time IS NULL
      AND NOT EXISTS (SELECT 1 FROM private.notifications n
                      WHERE n.recipient_id = a.employee_id AND n.kind = 'reminder_out'
                        AND (n.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_today);
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION private.send_punch_reminders(text) FROM PUBLIC, anon, authenticated;

COMMIT;

-- ---------------------------------------------------------------------
-- Schedule (pg_cron runs in UTC: 05:30 UTC = 11:00 IST, 14:15 UTC = 19:45 IST)
-- Kept outside the transaction so a missing extension can't undo the above.
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job
  WHERE jobname IN ('staffly-reminder-in', 'staffly-reminder-out');
  PERFORM cron.schedule('staffly-reminder-in',  '30 5 * * 1-6',  $c$SELECT private.send_punch_reminders('in')$c$);
  PERFORM cron.schedule('staffly-reminder-out', '15 14 * * 1-6', $c$SELECT private.send_punch_reminders('out')$c$);
  RAISE NOTICE 'reminders scheduled';
END $$;

-- Check:  SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'staffly-%';
-- Test now (sends real reminders!):  SELECT private.send_punch_reminders('in');
