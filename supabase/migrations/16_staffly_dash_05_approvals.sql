-- 16: Extra day / Night approvals for the PC dashboard (applied to Supabase on 30 Oct 2026 as migration 20261030130312).
-- Already live: you do NOT need to run this again. Kept here as the record.
-- Extra (run separately on 30 Oct): admin EMP101 can also send requests, for testing:
--   insert into private.dash_appr_people (employee_id, can_request) values ('EMP101', true) on conflict (employee_id) do update set can_request = true;

-- Extra day / Night approval flow for the PC dashboard.
-- Requesters (Anshu, Avinash) ask; approver (Neelam) decides; only approved requests write a dash_corrections row.

create table if not exists private.dash_appr_people (
  employee_id text primary key references public.employees(employee_id),
  can_request boolean not null default false,
  can_approve boolean not null default false
);
alter table private.dash_appr_people enable row level security;

insert into private.dash_appr_people (employee_id, can_request, can_approve) values
  ('DCC209', true, false),   -- Anshu Kumar Sharma
  ('DCC221', true, false),   -- Avinash Saxena
  ('DCC210', false, true)    -- Neelam Sharma
on conflict (employee_id) do update set can_request = excluded.can_request, can_approve = excluded.can_approve;

create table if not exists private.dash_requests (
  id bigint generated always as identity primary key,
  employee_id text not null references public.employees(employee_id),
  work_date date not null,
  kind text not null check (kind in ('extra','night')),
  reason text not null check (length(reason) between 3 and 300),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by text not null references public.employees(employee_id),
  requested_at timestamptz not null default now(),
  decided_by text references public.employees(employee_id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 300),
  correction_id bigint
);
alter table private.dash_requests enable row level security;
create unique index if not exists dash_requests_one_open
  on private.dash_requests (employee_id, work_date, kind) where status in ('pending','approved');
create index if not exists dash_requests_status_idx on private.dash_requests (status, requested_at desc);
create index if not exists dash_requests_requested_by_idx on private.dash_requests (requested_by);

-- who am I in the approval flow
create or replace function private.dash_appr_rights(p_emp text)
returns table(can_request boolean, can_approve boolean, is_admin boolean)
language sql stable security definer set search_path = public, private
as $$
  select coalesce(p.can_request,false), coalesce(p.can_approve,false), private.is_admin_role(p_emp)
  from (select p_emp as e) x left join private.dash_appr_people p on p.employee_id = x.e;
$$;

create or replace function public.dash_appr_me(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, private, extensions
as $$
declare v text := private.session_employee_id(p_token); r record;
begin
  select * into r from private.dash_appr_rights(v);
  return jsonb_build_object('can_request', r.can_request, 'can_approve', r.can_approve or r.is_admin, 'is_admin', r.is_admin,
    'pending', (select count(*) from private.dash_requests where status = 'pending'),
    'mine_pending', (select count(*) from private.dash_requests where status = 'pending' and requested_by = v));
end $$;

-- staff list for the request form (any branch)
create or replace function public.dash_appr_staff(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, private, extensions
as $$
declare v text := private.session_employee_id(p_token); r record;
begin
  select * into r from private.dash_appr_rights(v);
  if not (r.can_request or r.can_approve or r.is_admin) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object('today', private.dash_today(),
    'data_start', (select data_start from private.dash_settings where id = 1),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', m.dash_no, 'name', e.name, 'location', m.location) order by m.location, e.name)
      from public.employees e join private.dash_emp m on m.employee_id = e.employee_id
      where m.tracked and e.status = 'Active' and m.left_on is null), '[]'::jsonb));
end $$;

create or replace function public.dash_appr_request(p_token text, p_emp bigint, p_date date, p_kind text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private, extensions
as $$
declare v text := private.session_employee_id(p_token); r record; v_target text; v_ds date; v_id bigint; v_reason text := btrim(coalesce(p_reason,''));
begin
  select * into r from private.dash_appr_rights(v);
  if not (r.can_request or r.is_admin) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_kind not in ('extra','night') then raise exception 'Choose Extra day or Night'; end if;
  if length(v_reason) < 3 then raise exception 'Write a reason'; end if;
  select e.employee_id into v_target from private.dash_emp m join public.employees e on e.employee_id = m.employee_id
   where m.dash_no = p_emp and m.tracked and e.status = 'Active';
  if v_target is null then raise exception 'Employee not found'; end if;
  if p_date is null or p_date > private.dash_today() then raise exception 'Pick a date up to today'; end if;
  select data_start into v_ds from private.dash_settings where id = 1;
  if p_date < v_ds then raise exception 'That date is before the attendance data starts'; end if;
  if p_date < private.dash_today() - 62 then raise exception 'Requests can only go back about 2 months'; end if;
  if exists (select 1 from private.dash_requests where employee_id = v_target and work_date = p_date and kind = p_kind and status in ('pending','approved')) then
    raise exception 'Already requested for this person and day';
  end if;
  insert into private.dash_requests (employee_id, work_date, kind, reason, requested_by)
  values (v_target, p_date, p_kind, left(v_reason, 300), v) returning id into v_id;
  insert into public.audit_log (employee_id, action, details)
  values (v, 'appr_request', jsonb_build_object('id', v_id, 'employee', v_target, 'date', p_date, 'kind', p_kind));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- list: approver/admin see all, requester sees own
create or replace function public.dash_appr_list(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, private, extensions
as $$
declare v text := private.session_employee_id(p_token); r record; v_all boolean;
begin
  select * into r from private.dash_appr_rights(v);
  if not (r.can_request or r.can_approve or r.is_admin) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v_all := r.can_approve or r.is_admin;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id, 'emp_no', m.dash_no, 'employee', e.name, 'location', m.location, 'date', q.work_date, 'kind', q.kind,
      'reason', q.reason, 'status', q.status, 'requested_by', rb.name, 'mine', q.requested_by = v, 'requested_at', q.requested_at,
      'decided_by', db.name, 'decided_at', q.decided_at, 'note', q.decision_note,
      'day', (select jsonb_build_object('status', d.status, 'in', d.in_time::text, 'out', d.out_time::text, 'hours', d.hours)
              from private.dash_daily(q.work_date, q.work_date, m.dash_no) d limit 1)
    ) order by (q.status = 'pending') desc, q.requested_at desc)
    from private.dash_requests q
    join public.employees e on e.employee_id = q.employee_id
    left join private.dash_emp m on m.employee_id = q.employee_id
    join public.employees rb on rb.employee_id = q.requested_by
    left join public.employees db on db.employee_id = q.decided_by
    where (v_all or q.requested_by = v) and (q.status = 'pending' or q.requested_at > now() - interval '120 days')
  ), '[]'::jsonb));
end $$;

create or replace function public.dash_appr_decide(p_token text, p_id bigint, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, private, extensions
as $$
declare v text := private.session_employee_id(p_token); r record; q private.dash_requests%rowtype; v_cid bigint; v_note text := nullif(btrim(coalesce(p_note,'')), '');
  v_rb text;
begin
  select * into r from private.dash_appr_rights(v);
  if not (r.can_approve or r.is_admin) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_decision not in ('approve','reject') then raise exception 'Bad request'; end if;
  select * into q from private.dash_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if q.status <> 'pending' then raise exception 'This request was already %', q.status; end if;
  if q.requested_by = v and not r.is_admin then raise exception 'You cannot approve your own request'; end if;
  if p_decision = 'reject' and v_note is null then raise exception 'Add a comment so they know why it was rejected'; end if;
  if p_decision = 'approve' then
    select name into v_rb from public.employees where employee_id = q.requested_by;
    insert into private.dash_corrections (employee_id, work_date, status, night, source, remark)
    values (q.employee_id, q.work_date,
            case when q.kind = 'extra' then 'Extra Day' end,
            q.kind = 'night',
            left('Approved ' || case when q.kind = 'extra' then 'Extra day' else 'Night' end || ' (asked by ' || split_part(v_rb, ' ', 1) || ')', 80),
            left(coalesce(v_note, q.reason), 300))
    returning id into v_cid;
  end if;
  update private.dash_requests set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    decided_by = v, decided_at = now(), decision_note = left(v_note, 300), correction_id = v_cid
  where id = p_id;
  insert into public.audit_log (employee_id, action, details)
  values (v, 'appr_' || p_decision, jsonb_build_object('id', p_id, 'employee', q.employee_id, 'date', q.work_date, 'kind', q.kind));
  return jsonb_build_object('ok', true);
end $$;

-- requester cancels own pending; admin can cancel anything (approved -> its correction is voided)
create or replace function public.dash_appr_cancel(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, private, extensions
as $$
declare v text := private.session_employee_id(p_token); r record; q private.dash_requests%rowtype;
begin
  select * into r from private.dash_appr_rights(v);
  select * into q from private.dash_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not (r.is_admin or (q.requested_by = v and q.status = 'pending')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if q.status not in ('pending','approved') then raise exception 'This request is already %', q.status; end if;
  if q.correction_id is not null then
    update private.dash_corrections set voided_at = now() where id = q.correction_id and voided_at is null;
  end if;
  update private.dash_requests set status = 'cancelled', decided_by = v, decided_at = now() where id = p_id;
  insert into public.audit_log (employee_id, action, details)
  values (v, 'appr_cancel', jsonb_build_object('id', p_id, 'employee', q.employee_id, 'date', q.work_date, 'kind', q.kind, 'was', q.status));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.dash_appr_rights(text) from public, anon, authenticated;
revoke all on function public.dash_appr_me(text), public.dash_appr_staff(text), public.dash_appr_request(text,bigint,date,text,text),
  public.dash_appr_list(text), public.dash_appr_decide(text,bigint,text,text), public.dash_appr_cancel(text,bigint) from public;
grant execute on function public.dash_appr_me(text), public.dash_appr_staff(text), public.dash_appr_request(text,bigint,date,text,text),
  public.dash_appr_list(text), public.dash_appr_decide(text,bigint,text,text), public.dash_appr_cancel(text,bigint) to anon, authenticated;
