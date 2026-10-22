-- Staffly dashboard - step 2: the daily register + read functions + admin-mode login.

-- ---------- the daily register (same rules as the old dashboard, built on Staffly punches) ----------
create or replace function private.dash_daily(p_from date, p_to date, p_dash_no bigint default null)
returns table (dash_no bigint, employee_id text, employee text, location text, work_date date, day text,
  in_time time, out_time time, hours numeric, status text, ot_hours numeric, late_in boolean, late_out boolean,
  night boolean, n_in int, n_out int, flag text, source text, note text)
language sql stable security definer set search_path = public, private, extensions
as $$
with s as (select * from private.dash_settings where id = 1),
days as (
  select d::date as work_date
  from s, generate_series(greatest(p_from, s.data_start), least(p_to, (now() at time zone 'Asia/Kolkata')::date), interval '1 day') d
),
roster as (
  select m.dash_no, e.employee_id, e.name, m.location, m.in_only, m.no_auto_half_day, d.work_date
  from public.employees e
  join private.dash_emp m on m.employee_id = e.employee_id
  join days d on d.work_date >= coalesce(e.joining_date, date '1900-01-01')
             and (m.left_on is null or d.work_date <= m.left_on)
  where m.tracked and (e.status = 'Active' or m.left_on is not null)
    and (p_dash_no is null or m.dash_no = p_dash_no)
),
pun as (
  select a.employee_id, a.work_date,
         (a.clock_in_time  at time zone 'Asia/Kolkata') as first_in,
         (a.clock_out_time at time zone 'Asia/Kolkata') as last_out,
         (a.clock_in_time  is not null)::int as n_in,
         (a.clock_out_time is not null)::int as n_out
  from public.attendance a
),
corr_punch as (
  select distinct on (c.employee_id, c.work_date, c.io)
         c.employee_id, c.work_date, c.io, c.punch_time, c.out_next_day
  from private.dash_corrections c where c.io is not null and c.voided_at is null
  order by c.employee_id, c.work_date, c.io, c.created_at desc
),
corr_in  as (select employee_id, work_date, work_date + punch_time as ts from corr_punch where io = 'In'),
corr_out as (select employee_id, work_date,
                    work_date + punch_time + case when out_next_day then interval '1 day' else interval '0' end as ts
             from corr_punch where io = 'Out'),
corr_flags as (
  select c.employee_id, c.work_date,
         (array_agg(c.status order by c.created_at desc) filter (where c.status is not null))[1] as status,
         bool_or(c.night) as night,
         string_agg(distinct nullif(concat_ws(' | ', c.source, c.remark), ''), ' ; ') as note
  from private.dash_corrections c where c.voided_at is null group by 1,2
),
calc as (
  select r.dash_no, r.employee_id, r.name as employee, r.location, r.work_date, r.in_only, r.no_auto_half_day,
         coalesce(ci.ts, p.first_in) as in_ts,
         coalesce(co.ts, p.last_out) as out_ts,
         coalesce(p.n_in,0) as n_in, coalesce(p.n_out,0) as n_out,
         cf.status as corr_status, coalesce(cf.night,false) as night, cf.note,
         (extract(dow from r.work_date) = 0) as is_sunday,
         exists (select 1 from private.dash_holidays h where h.holiday_date = r.work_date) as is_holiday,
         (ci.ts is not null or co.ts is not null or cf.status is not null) as corrected
  from roster r
  left join pun p         on p.employee_id = r.employee_id and p.work_date = r.work_date
  left join corr_in ci    on ci.employee_id = r.employee_id and ci.work_date = r.work_date
  left join corr_out co   on co.employee_id = r.employee_id and co.work_date = r.work_date
  left join corr_flags cf on cf.employee_id = r.employee_id and cf.work_date = r.work_date
),
hrs as (
  select c.*,
    case when in_ts is not null and out_ts is not null and out_ts > in_ts
         then round((extract(epoch from out_ts - in_ts) / 3600)::numeric, 2) end as hours
  from calc c
),
st as (
  select h.*,
    (h.corr_status is null and (h.in_ts is not null or h.out_ts is not null)
      and not (h.is_sunday or h.is_holiday) and not h.in_only and not h.no_auto_half_day
      and coalesce(h.hours >= s.half_day_min and h.hours < s.half_day_below, false)) as auto_half
  from hrs h cross join s
)
select
  h.dash_no, h.employee_id, h.employee, h.location, h.work_date, to_char(h.work_date, 'Dy') as day,
  h.in_ts::time(0) as in_time, h.out_ts::time(0) as out_time, h.hours,
  case
    when h.corr_status is not null then h.corr_status
    when h.in_ts is not null or h.out_ts is not null then
      case when h.is_sunday or h.is_holiday then 'Extra Day'
           when h.in_only then (case when h.in_ts is not null then 'Present' else 'Missing Punch' end)
           when h.work_date = (now() at time zone 'Asia/Kolkata')::date and h.out_ts is null then 'In Progress'
           when h.hours is null or h.hours < s.half_day_min then 'Missing Punch'
           when h.auto_half then 'Half Day'
           else 'Present' end
    when h.is_holiday then 'Holiday'
    when h.is_sunday then 'Sunday'
    else 'Absent' end as status,
  case when h.hours > s.shift_hours then round(h.hours - s.shift_hours, 2) else 0 end as ot_hours,
  coalesce(h.in_ts is not null and not h.auto_half
     and date_trunc('minute', h.in_ts) > h.work_date + s.late_in_after, false) as late_in,
  coalesce(h.out_ts is not null and h.out_ts >= h.work_date + s.late_out_from, false) as late_out,
  h.night, h.n_in::int, h.n_out::int,
  case when h.in_ts is not null and h.out_ts is not null and h.out_ts <= h.in_ts then 'Out before In (labels reversed?)'
       when h.n_in > 1 or h.n_out > 1 then 'Duplicate punches' end as flag,
  case when h.corrected then 'Corrected' when h.n_in + h.n_out > 0 then 'System punch' end as source,
  h.note
from st h cross join s;
$$;

-- admin mode must be switched on (password re-entered, 30 minutes) before any change is allowed
create or replace function private.dash_need_admin(p_token text) returns text
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_emp text := private.session_employee_id(p_token);
begin
  if not private.is_admin_role(v_emp) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from private.dash_admin_elev
                 where token_hash = digest(p_token, 'sha256') and expires_at > now()) then
    raise exception 'AUTH_EXPIRED';
  end if;
  return v_emp;
end $$;

create or replace function private.dash_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ---------- public wrappers (all need a Staffly admin session: Admin / HR / Dev) ----------
create or replace function public.dash_employees(p_token text) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
begin
  perform private.require_admin(p_token);
  perform private.dash_sync();
  return jsonb_build_object(
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', m.dash_no, 'code', e.employee_id, 'name', e.name,
        'location', m.location, 'active', e.status = 'Active', 'left_on', m.left_on, 'joined_on', e.joining_date)
        order by e.name) from public.employees e join private.dash_emp m on m.employee_id = e.employee_id where m.tracked), '[]'::jsonb),
    'today', private.dash_today(),
    'data_start', (select data_start from private.dash_settings where id = 1),
    'latest_punch', (select max(greatest(clock_in_time, clock_out_time)) from public.attendance),
    'locations', coalesce((select jsonb_agg(name order by sort, name) from private.dash_locations), '[]'::jsonb));
end $$;

create or replace function public.dash_range(p_token text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_t date := private.dash_today(); v_ds date; v_from date := p_from; v_to date := p_to;
begin
  perform private.require_admin(p_token);
  if v_from is null or v_to is null then raise exception 'Bad request'; end if;
  select data_start into v_ds from private.dash_settings where id = 1;
  if v_from < v_ds then v_from := v_ds; end if;
  if v_to > v_t then v_to := v_t; end if;
  if v_from > v_to then return jsonb_build_object('from', v_from, 'to', v_to, 'today', v_t, 'rows', '[]'::jsonb); end if;
  if v_to - v_from > 95 then raise exception 'Pick a range of up to 3 months'; end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'today', v_t, 'rows', coalesce((
    select jsonb_agg(jsonb_build_array(d.dash_no, d.work_date, d.status, d.in_time::text, d.out_time::text, d.hours, d.ot_hours,
        case when d.late_in then 1 else 0 end, case when d.late_out then 1 else 0 end, case when d.night then 1 else 0 end,
        coalesce(d.source, ''), coalesce(d.note, '')) order by d.work_date, d.dash_no)
    from private.dash_daily(v_from, v_to) d), '[]'::jsonb));
end $$;

create or replace function public.dash_calendar(p_token text, p_emp bigint, p_month text) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_t date := private.dash_today(); v_ds date; v_first date; v_last date; v_from date; v_to date; v_emp jsonb;
begin
  perform private.require_admin(p_token);
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Bad request'; end if;
  select data_start into v_ds from private.dash_settings where id = 1;
  v_first := (p_month || '-01')::date; v_last := (v_first + interval '1 month - 1 day')::date;
  v_from := greatest(v_first, v_ds); v_to := least(v_last, v_t);
  select jsonb_build_object('id', m.dash_no, 'name', e.name, 'location', m.location, 'active', e.status = 'Active',
         'joined_on', e.joining_date, 'left_on', m.left_on)
    into v_emp from public.employees e join private.dash_emp m on m.employee_id = e.employee_id
   where m.dash_no = p_emp and m.tracked;
  if v_emp is null then raise exception 'Employee not found'; end if;
  return jsonb_build_object('employee', v_emp, 'month', p_month, 'from', v_from, 'to', v_to, 'today', v_t, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('work_date', d.work_date, 'day', d.day, 'status', d.status, 'in_time', d.in_time::text,
        'out_time', d.out_time::text, 'hours', d.hours, 'ot_hours', d.ot_hours, 'late_in', d.late_in, 'late_out', d.late_out,
        'night', d.night, 'flag', d.flag, 'source', d.source, 'note', d.note, 'n_in', d.n_in, 'n_out', d.n_out) order by d.work_date)
    from private.dash_daily(v_from, v_to, p_emp) d where v_from <= v_to), '[]'::jsonb));
end $$;

create or replace function public.dash_day_punches(p_token text, p_emp bigint, p_date date) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_id text; v_loc text;
begin
  perform private.require_admin(p_token);
  select m.employee_id, m.location into v_id, v_loc from private.dash_emp m where m.dash_no = p_emp;
  if v_id is null or p_date is null then raise exception 'Bad request'; end if;
  return jsonb_build_object('punches', coalesce((
    select jsonb_agg(x.j order by x.ts) from (
      select a.clock_in_time as ts, jsonb_build_object('local_ts', to_char(a.clock_in_time at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
             'io', 'In', 'location', v_loc, 'photo_url', a.photo_url) as j
        from public.attendance a where a.employee_id = v_id and a.work_date = p_date and a.clock_in_time is not null
      union all
      select a.clock_out_time, jsonb_build_object('local_ts', to_char(a.clock_out_time at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
             'io', 'Out', 'location', v_loc, 'photo_url', a.clock_out_photo_url)
        from public.attendance a where a.employee_id = v_id and a.work_date = p_date and a.clock_out_time is not null
    ) x), '[]'::jsonb));
end $$;

-- ---------- admin mode ----------
create or replace function public.dash_admin_login(p_token text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_emp text; v_hash text; v_key text; v_att private.login_attempts%rowtype;
begin
  v_emp := private.session_employee_id(p_token);
  if not private.is_admin_role(v_emp) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v_key := 'dashadmin:' || lower(v_emp);
  select * into v_att from private.login_attempts where login_key = v_key;
  if found and v_att.locked_until is not null then
    if v_att.locked_until > now() then
      return jsonb_build_object('error', 'Too many wrong attempts. Try again in 15 minutes.');
    end if;
    delete from private.login_attempts where login_key = v_key;
  end if;
  select password_hash into v_hash from public.employees where employee_id = v_emp;
  if v_hash is null or crypt(coalesce(p_password, ''), v_hash) <> v_hash then
    insert into private.login_attempts (login_key, failed_count, locked_until) values (v_key, 1, null)
    on conflict (login_key) do update set
      failed_count = private.login_attempts.failed_count + 1,
      locked_until = case when private.login_attempts.failed_count + 1 >= 5 then now() + interval '15 minutes' else null end;
    return jsonb_build_object('error', 'Wrong password');
  end if;
  delete from private.login_attempts where login_key = v_key;
  insert into private.dash_admin_elev (token_hash, employee_id, expires_at)
  values (digest(p_token, 'sha256'), v_emp, now() + interval '30 minutes')
  on conflict (token_hash) do update set expires_at = excluded.expires_at;
  delete from private.dash_admin_elev where expires_at < now() - interval '1 day';
  insert into public.audit_log (employee_id, action, details) values (v_emp, 'dash_admin_on', '{}'::jsonb);
  return jsonb_build_object('token', p_token, 'seconds_left', 1800);
end $$;

create or replace function public.dash_admin_off(p_token text) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
begin
  perform private.session_employee_id(p_token);
  delete from private.dash_admin_elev where token_hash = digest(p_token, 'sha256');
  return jsonb_build_object('ok', true);
end $$;
