-- Staffly dashboard step 4: admin functions (edit a day, add/remove/restore staff, Excel + salary data).
-- Every function needs a Staffly Admin/HR/Dev login AND admin mode switched on (password re-entered, 30 min).

-- the admin account is not a staff member to track
update private.dash_emp set tracked = false where employee_id = 'EMP101';

-- what a day looks like for the edit panel
create or replace function public.dash_admin_punches(p_token text, p_emp bigint, p_date date) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_id text;
begin
  perform private.dash_need_admin(p_token);
  select employee_id into v_id from private.dash_emp where dash_no = p_emp;
  if v_id is null or p_date is null then raise exception 'Bad request'; end if;
  return public.dash_day_punches(p_token, p_emp, p_date)
    || jsonb_build_object('corrections', coalesce((
         select jsonb_agg(jsonb_build_object('io', c.io, 'punch_time', c.punch_time::text, 'out_next_day', c.out_next_day,
                'status', c.status, 'night', c.night, 'source', c.source, 'remark', c.remark, 'created_at', c.created_at) order by c.created_at)
         from private.dash_corrections c where c.employee_id = v_id and c.work_date = p_date and c.voided_at is null), '[]'::jsonb));
end $$;

-- save a manual fix (old fixes for that day are kept in history, marked voided)
create or replace function public.dash_admin_set_day(p_token text, b jsonb) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_adm text; v_id text; v_date date; v_in time; v_out time; v_status text; v_night boolean; v_next boolean;
  v_src text; v_rem text; v_ds date; v_n int := 0;
begin
  v_adm := private.dash_need_admin(p_token);
  select employee_id into v_id from private.dash_emp where dash_no = nullif(b->>'employee_id','')::bigint;
  if v_id is null then raise exception 'Bad request'; end if;
  v_date := (b->>'date')::date;
  if v_date > private.dash_today() then raise exception 'Cannot edit a future date'; end if;
  select data_start into v_ds from private.dash_settings where id = 1;
  if v_date < v_ds then raise exception 'Date is before the data start'; end if;
  v_in  := nullif(b->>'in','')::time;
  v_out := nullif(b->>'out','')::time;
  v_status := nullif(b->>'status','');
  if v_status is not null and v_status not in ('Present','Absent','Half Day','Extra Day','Holiday') then raise exception 'Unknown status'; end if;
  v_night := coalesce((b->>'night')::boolean, false);
  v_next  := coalesce((b->>'out_next_day')::boolean, false);
  v_src := left(coalesce(nullif(b->>'source',''), 'Admin'), 80);
  v_rem := left(nullif(b->>'remark',''), 300);
  if v_in is null and v_out is null and v_status is null and not v_night and v_rem is null then
    raise exception 'Nothing to save. Use "Clear my changes" to remove corrections.';
  end if;

  update private.dash_corrections set voided_at = now()
   where employee_id = v_id and work_date = v_date and voided_at is null;

  if v_in is not null then
    insert into private.dash_corrections (employee_id, work_date, io, punch_time, source, remark) values (v_id, v_date, 'In', v_in, v_src, v_rem); v_n := v_n + 1;
  end if;
  if v_out is not null then
    insert into private.dash_corrections (employee_id, work_date, io, punch_time, out_next_day, source, remark) values (v_id, v_date, 'Out', v_out, v_next, v_src, v_rem); v_n := v_n + 1;
  end if;
  if v_status is not null or v_night or (v_in is null and v_out is null) then
    insert into private.dash_corrections (employee_id, work_date, status, night, source, remark) values (v_id, v_date, v_status, v_night, v_src, v_rem); v_n := v_n + 1;
  end if;

  insert into public.audit_log (employee_id, action, details)
  values (v_adm, 'dash_set_day', jsonb_build_object('employee', v_id, 'date', v_date, 'in', v_in, 'out', v_out, 'status', v_status, 'night', v_night, 'remark', v_rem));
  return jsonb_build_object('ok', true, 'saved', v_n);
end $$;

create or replace function public.dash_admin_clear_day(p_token text, b jsonb) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_adm text; v_id text; v_date date; v_n int;
begin
  v_adm := private.dash_need_admin(p_token);
  select employee_id into v_id from private.dash_emp where dash_no = nullif(b->>'employee_id','')::bigint;
  v_date := (b->>'date')::date;
  if v_id is null or v_date is null then raise exception 'Bad request'; end if;
  update private.dash_corrections set voided_at = now() where employee_id = v_id and work_date = v_date and voided_at is null;
  get diagnostics v_n = row_count;
  insert into public.audit_log (employee_id, action, details) values (v_adm, 'dash_clear_day', jsonb_build_object('employee', v_id, 'date', v_date, 'cleared', v_n));
  return jsonb_build_object('ok', true, 'cleared', v_n);
end $$;

-- add staff: creates the Staffly login too (employee id is generated: DCC + next number)
create or replace function public.dash_admin_add_employee(p_token text, b jsonb) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_adm text; v_name text; v_loc text; v_join date; v_pw text; v_id text; v_dup record; v_office uuid; v_next int;
begin
  v_adm := private.dash_need_admin(p_token);
  v_name := btrim(regexp_replace(coalesce(b->>'name',''), '\s+', ' ', 'g'));
  if length(v_name) < 2 or length(v_name) > 60 or v_name !~ '^[A-Za-z][A-Za-z .''\-]*$' then
    raise exception 'Enter the name using letters only (2-60 characters)';
  end if;
  v_loc := coalesce(b->>'location','');
  if not exists (select 1 from private.dash_locations where name = v_loc) then raise exception 'Pick a location from the list'; end if;
  v_join := coalesce(nullif(b->>'joined_on','')::date, private.dash_today());
  v_office := case v_loc when 'Okhla' then (select id from public.offices where name = 'DDC Okhla')
                         when 'Gurgaon' then (select id from public.offices where name = 'DDC Gurgaon')
                         else '11111111-1111-1111-1111-111111111111'::uuid end;

  select e.employee_id, e.status, m.location into v_dup
    from public.employees e join private.dash_emp m on m.employee_id = e.employee_id
   where lower(btrim(e.name)) = lower(v_name) limit 1;
  if found then
    if v_dup.status = 'Active' then raise exception '% already exists (%)', v_name, v_dup.location; end if;
    update public.employees set status = 'Active', joining_date = v_join, office_id = v_office where employee_id = v_dup.employee_id;
    update private.dash_emp set left_on = null, location = v_loc where employee_id = v_dup.employee_id;
    insert into public.audit_log (employee_id, action, details) values (v_adm, 'dash_restore_employee', jsonb_build_object('employee', v_dup.employee_id));
    return jsonb_build_object('ok', true, 'restored', true, 'employee_id', v_dup.employee_id);
  end if;

  v_pw := coalesce(b->>'password','');
  if length(v_pw) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  select coalesce(max(substring(employee_id from '^DCC(\d+)$')::int), 200) + 1 into v_next from public.employees where employee_id ~ '^DCC\d+$';
  v_id := 'DCC' || v_next;

  insert into public.employees (employee_id, name, password_hash, role, office_id, status, joining_date)
  values (v_id, v_name, crypt(v_pw, gen_salt('bf')), 'Employee', v_office, 'Active', v_join);
  perform private.dash_sync();
  update private.dash_emp set location = v_loc where employee_id = v_id;
  insert into public.audit_log (employee_id, action, details) values (v_adm, 'dash_add_employee', jsonb_build_object('employee', v_id, 'name', v_name, 'location', v_loc));
  return jsonb_build_object('ok', true, 'restored', false, 'employee_id', v_id);
end $$;

-- remove staff: login disabled, history kept
create or replace function public.dash_admin_remove_employee(p_token text, b jsonb) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_adm text; v_id text; v_last date;
begin
  v_adm := private.dash_need_admin(p_token);
  select employee_id into v_id from private.dash_emp where dash_no = nullif(b->>'id','')::bigint;
  if v_id is null then raise exception 'Bad request'; end if;
  if v_id = v_adm then raise exception 'You cannot remove your own login'; end if;
  v_last := coalesce(nullif(b->>'left_on','')::date, private.dash_today());
  update public.employees set status = 'Inactive' where employee_id = v_id;
  update private.dash_emp set left_on = v_last where employee_id = v_id;
  delete from private.app_sessions where employee_id = v_id;
  insert into public.audit_log (employee_id, action, details) values (v_adm, 'dash_remove_employee', jsonb_build_object('employee', v_id, 'left_on', v_last));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.dash_admin_restore_employee(p_token text, b jsonb) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_adm text; v_id text;
begin
  v_adm := private.dash_need_admin(p_token);
  select employee_id into v_id from private.dash_emp where dash_no = nullif(b->>'id','')::bigint;
  if v_id is null then raise exception 'Bad request'; end if;
  update public.employees set status = 'Active' where employee_id = v_id;
  update private.dash_emp set left_on = null where employee_id = v_id;
  insert into public.audit_log (employee_id, action, details) values (v_adm, 'dash_restore_employee', jsonb_build_object('employee', v_id));
  return jsonb_build_object('ok', true);
end $$;

-- raw data for the month-end Excel (the browser builds the file)
create or replace function public.dash_admin_export_data(p_token text, p_month text) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_first date; v_last date; v_t date := private.dash_today(); v_ds date;
begin
  perform private.dash_need_admin(p_token);
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Bad month'; end if;
  select data_start into v_ds from private.dash_settings where id = 1;
  v_first := (p_month || '-01')::date; v_last := (v_first + interval '1 month - 1 day')::date;
  if v_last < v_ds then raise exception 'This month is before the data start'; end if;
  if v_first > v_t then raise exception 'This month has not started yet'; end if;
  return jsonb_build_object('month', p_month, 'today', v_t, 'hourIST', extract(hour from now() at time zone 'Asia/Kolkata')::int, 'data_start', v_ds,
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', m.dash_no, 'name', e.name, 'location', m.location,
          'joined_on', e.joining_date, 'left_on', m.left_on, 'active', e.status = 'Active') order by m.dash_no)
        from public.employees e join private.dash_emp m on m.employee_id = e.employee_id
        where m.tracked and (e.joining_date is null or e.joining_date <= v_last) and (m.left_on is null or m.left_on >= v_first)), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('employee_id', d.dash_no, 'work_date', d.work_date, 'status', d.status,
          'in_time', d.in_time::text, 'out_time', d.out_time::text, 'night', d.night) order by d.work_date, d.dash_no)
        from private.dash_daily(v_first, v_last) d), '[]'::jsonb));
end $$;

-- raw data for the salary preview (month +/- 10 days for the Sunday-in-leave rule)
create or replace function public.dash_admin_salary_data(p_token text, p_month text) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_first date; v_last date; v_t date := private.dash_today(); v_ds date; v_from date; v_to date;
begin
  perform private.dash_need_admin(p_token);
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Bad request'; end if;
  if not exists (select 1 from private.dash_salary) then return jsonb_build_object('setup_needed', true, 'month', p_month); end if;
  select data_start into v_ds from private.dash_settings where id = 1;
  v_first := (p_month || '-01')::date; v_last := (v_first + interval '1 month - 1 day')::date;
  v_from := greatest(v_first - 10, v_ds); v_to := least(v_last + 10, v_t);
  return jsonb_build_object('month', p_month, 'today', v_t,
    'salaries', (select jsonb_agg(jsonb_build_object('employee_id', m.dash_no, 'monthly_salary', s.monthly_salary))
                 from private.dash_salary s join private.dash_emp m on m.employee_id = s.employee_id),
    'emps', coalesce((select jsonb_agg(jsonb_build_object('id', m.dash_no, 'name', e.name, 'location', m.location, 'active', e.status = 'Active'))
                      from public.employees e join private.dash_emp m on m.employee_id = e.employee_id where m.tracked), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('employee_id', d.dash_no, 'work_date', d.work_date, 'status', d.status) order by d.work_date, d.dash_no)
                      from private.dash_daily(v_from, v_to) d where v_from <= v_to), '[]'::jsonb));
end $$;

-- only logged-in clients may call these (the code inside re-checks the admin role anyway)
revoke execute on function public.dash_admin_punches(text,bigint,date), public.dash_admin_set_day(text,jsonb), public.dash_admin_clear_day(text,jsonb),
  public.dash_admin_add_employee(text,jsonb), public.dash_admin_remove_employee(text,jsonb), public.dash_admin_restore_employee(text,jsonb),
  public.dash_admin_export_data(text,text), public.dash_admin_salary_data(text,text) from public;
grant execute on function public.dash_admin_punches(text,bigint,date), public.dash_admin_set_day(text,jsonb), public.dash_admin_clear_day(text,jsonb),
  public.dash_admin_add_employee(text,jsonb), public.dash_admin_remove_employee(text,jsonb), public.dash_admin_restore_employee(text,jsonb),
  public.dash_admin_export_data(text,text), public.dash_admin_salary_data(text,text) to anon, authenticated;
