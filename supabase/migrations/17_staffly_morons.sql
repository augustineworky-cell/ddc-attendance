-- 17: Morons - a guard punches labours (no smartphone) in and out from his own Staffly login.
-- Normal login is untouched. Admin/Dev picks the guards (each with a 4-digit Moron PIN) and the workers.
-- Guard: logs in normally -> menu "Morons" -> Moron PIN -> list of workers of HIS branch -> photo -> Punch In / Out.

create table if not exists private.moron_guards (
  employee_id text primary key references public.employees(employee_id) on delete cascade,
  pin_hash    text not null,
  failed      int  not null default 0,
  locked_until timestamptz,
  added_by    text,
  added_at    timestamptz not null default now()
);
create table if not exists private.moron_workers (
  employee_id text primary key references public.employees(employee_id) on delete cascade,
  added_by    text,
  added_at    timestamptz not null default now()
);
create table if not exists private.moron_keys (
  key_hash   bytea primary key,
  guard      text not null references private.moron_guards(employee_id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists private.moron_log (
  id         bigserial primary key,
  worker     text not null,
  guard      text not null,
  kind       text not null check (kind in ('in','out')),
  punch_at   timestamptz not null,
  work_date  date not null,
  source     text,
  photo_url  text,
  offline    boolean not null default false,
  lat double precision, lng double precision, distance_m numeric,
  created_at timestamptz not null default now()
);
create index if not exists moron_log_worker_idx on private.moron_log (worker, created_at desc);
revoke all on private.moron_guards, private.moron_workers, private.moron_keys, private.moron_log from public, anon, authenticated;

create or replace function private.moron_loc(p_office uuid) returns text
language sql stable security definer set search_path = public, private as $$
  select coalesce(regexp_replace(o.name, '^DDC\s+', ''), '') from public.offices o where o.id = p_office
$$;

-- guard check for every mobile call: valid session + still a guard + valid unlocked key
create or replace function private.moron_guard(p_token text, p_key text) returns text
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_emp text := private.session_employee_id(p_token);
begin
  if not exists (select 1 from private.moron_guards where employee_id = v_emp) then
    raise exception 'MORON_NOT_GUARD' using errcode = '42501';
  end if;
  if p_key is null or not exists (select 1 from private.moron_keys k
       where k.key_hash = digest(p_key, 'sha256') and k.guard = v_emp and k.expires_at > now()) then
    raise exception 'MORON_LOCKED' using errcode = 'P0001';
  end if;
  return v_emp;
end $$;

/* ---------------- phone app ---------------- */
create or replace function public.moron_me(p_token text) returns json
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_emp text := private.session_employee_id(p_token); g record; v_office uuid;
begin
  select * into g from private.moron_guards where employee_id = v_emp;
  if not found then return json_build_object('is_guard', false); end if;
  select office_id into v_office from public.employees where employee_id = v_emp;
  return json_build_object('is_guard', true, 'location', private.moron_loc(v_office),
    'locked_minutes', case when g.locked_until > now() then ceil(extract(epoch from g.locked_until - now()) / 60) end);
end $$;

create or replace function public.moron_unlock(p_token text, p_pin text) returns json
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_emp text := private.session_employee_id(p_token); g record; v_key text; v_office uuid;
begin
  select * into g from private.moron_guards where employee_id = v_emp for update;
  if not found then return json_build_object('status', 'NOT_GUARD'); end if;
  if g.locked_until > now() then
    return json_build_object('status', 'LOCKED', 'minutes', ceil(extract(epoch from g.locked_until - now()) / 60));
  end if;
  if p_pin ~ '^\d{4}$' and g.pin_hash = crypt(p_pin, g.pin_hash) then
    update private.moron_guards set failed = 0, locked_until = null where employee_id = v_emp;
    delete from private.moron_keys where guard = v_emp and expires_at < now();
    v_key := encode(gen_random_bytes(24), 'hex');
    insert into private.moron_keys (key_hash, guard, expires_at) values (digest(v_key, 'sha256'), v_emp, now() + interval '16 hours');
    insert into public.audit_log (employee_id, action, details) values (v_emp, 'moron_unlock', '{}'::jsonb);
    select office_id into v_office from public.employees where employee_id = v_emp;
    return json_build_object('status', 'SUCCESS', 'key', v_key, 'location', private.moron_loc(v_office));
  end if;
  if g.failed + 1 >= 5 then
    update private.moron_guards set failed = 0, locked_until = now() + interval '15 minutes' where employee_id = v_emp;
    insert into public.audit_log (employee_id, action, details) values (v_emp, 'moron_pin_locked', '{}'::jsonb);
    return json_build_object('status', 'LOCKED', 'minutes', 15);
  end if;
  update private.moron_guards set failed = g.failed + 1 where employee_id = v_emp;
  return json_build_object('status', 'WRONG_PIN', 'attempts_left', 5 - (g.failed + 1));
end $$;

create or replace function public.moron_list(p_token text, p_key text) returns json
language plpgsql security definer set search_path = public, private, extensions as $$
declare v_guard text := private.moron_guard(p_token, p_key); v_office uuid;
        v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select office_id into v_office from public.employees where employee_id = v_guard;
  return json_build_object('location', private.moron_loc(v_office), 'today', v_today,
    'workers', coalesce((
      select json_agg(json_build_object('id', e.employee_id, 'name', e.name,
               'in', a.clock_in_time, 'out', a.clock_out_time,
               'next', case when a.clock_in_time is null then 'in' when a.clock_out_time is null then 'out' else 'done' end)
             order by e.name)
        from private.moron_workers w
        join public.employees e on e.employee_id = w.employee_id and e.status = 'Active' and e.office_id = v_office
        left join public.attendance a on a.employee_id = e.employee_id and a.work_date = v_today), '[]'::json));
end $$;

create or replace function public.moron_punch(p_token text, p_key text, p_worker text, p_kind text,
  p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_photo_path text, p_source text, p_at timestamptz default null) returns json
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_guard text := private.moron_guard(p_token, p_key);
  v_now timestamptz := now(); v_at timestamptz; v_offline boolean := false; v_date date;
  v_prefix text := 'https://bpwpxhsdmbkymhpjsfej.supabase.co/storage/v1/object/public/attendance-media/';
  v_url text; v_ev text; w record; o record; v_dist double precision; v_status text; v_row public.attendance%rowtype;
  v_hours numeric; v_src text := case when p_source = 'gallery' then 'gallery' else 'camera' end;
begin
  if p_kind not in ('in', 'out') then return json_build_object('status', 'BAD_REQUEST'); end if;
  select e.employee_id, e.name, e.office_id into w
    from private.moron_workers mw join public.employees e on e.employee_id = mw.employee_id
   where mw.employee_id = p_worker and e.status = 'Active'
     and e.office_id = (select office_id from public.employees where employee_id = v_guard);
  if not found then return json_build_object('status', 'NOT_ALLOWED'); end if;

  v_at := coalesce(p_at, v_now);
  if v_at > v_now + interval '2 minutes' then v_at := v_now; end if;
  if v_at < v_now - interval '36 hours' then return json_build_object('status', 'TOO_OLD'); end if;
  v_offline := p_at is not null and p_at < v_now - interval '2 minutes';
  v_date := (v_at at time zone 'Asia/Kolkata')::date;

  -- photo must already be uploaded: selfies/<worker>_<date>_<clockin|clockout>_...
  v_ev := case when p_kind = 'in' then 'clockin' else 'clockout' end;
  if p_photo_path is null or lower(p_photo_path) not like lower('selfies/' || w.employee_id || '\_' || v_date::text || '\_' || v_ev || '\_%')
     or not exists (select 1 from storage.objects where bucket_id = 'attendance-media' and name = p_photo_path) then
    return json_build_object('status', 'PHOTO_MISSING');
  end if;
  v_url := v_prefix || p_photo_path;

  -- the guard must be at the worker's branch
  if p_lat is null or p_lng is null then return json_build_object('status', 'NO_LOCATION'); end if;
  select lat, lng, radius_m into o from public.offices where id = w.office_id;
  v_dist := 6371000 * 2 * asin(sqrt(power(sin(radians(p_lat - o.lat) / 2), 2) +
            cos(radians(o.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - o.lng) / 2), 2)));
  if greatest(0, v_dist - least(coalesce(p_accuracy, 0), 100)) > o.radius_m then
    return json_build_object('status', 'OUT_OF_RANGE', 'distance_m', round(v_dist::numeric));
  end if;

  if p_kind = 'in' then
    v_status := case when (v_at at time zone 'Asia/Kolkata')::time > time '11:15' then 'Late' else 'Present' end;
    insert into public.attendance (employee_id, work_date, clock_in_time, clock_in_lat, clock_in_lng, distance_m, status, photo_url)
    values (w.employee_id, v_date, v_at, p_lat, p_lng, v_dist, v_status, v_url)
    on conflict (employee_id, work_date) do nothing;
    if not found then
      select * into v_row from public.attendance where employee_id = w.employee_id and work_date = v_date for update;
      if v_row.clock_in_time is not null then
        return json_build_object('status', 'ALREADY_IN', 'in', v_row.clock_in_time, 'out', v_row.clock_out_time);
      end if;
      update public.attendance set clock_in_time = v_at, clock_in_lat = p_lat, clock_in_lng = p_lng,
             distance_m = v_dist, status = v_status, photo_url = coalesce(photo_url, v_url)
       where employee_id = w.employee_id and work_date = v_date;
    end if;
  else
    select * into v_row from public.attendance where employee_id = w.employee_id and work_date = v_date for update;
    if v_row.clock_in_time is null then return json_build_object('status', 'NO_CLOCK_IN'); end if;
    if v_row.clock_out_time is not null then return json_build_object('status', 'ALREADY_OUT', 'out', v_row.clock_out_time); end if;
    if v_at <= v_row.clock_in_time then return json_build_object('status', 'BAD_TIME'); end if;
    v_hours := round(extract(epoch from (v_at - v_row.clock_in_time)) / 3600.0, 2);
    v_status := case when v_hours < 4.5 then 'Half Day'
                     when (v_row.clock_in_time at time zone 'Asia/Kolkata')::time > time '11:15' then 'Late' else 'Present' end;
    update public.attendance set clock_out_time = v_at, clock_out_lat = p_lat, clock_out_lng = p_lng,
           hours_worked = v_hours, status = v_status, clock_out_photo_url = coalesce(clock_out_photo_url, v_url)
     where employee_id = w.employee_id and work_date = v_date;
  end if;

  insert into private.moron_log (worker, guard, kind, punch_at, work_date, source, photo_url, offline, lat, lng, distance_m)
  values (w.employee_id, v_guard, p_kind, v_at, v_date, v_src, v_url, v_offline, p_lat, p_lng, round(v_dist::numeric));
  insert into public.audit_log (employee_id, action, details)
  values (w.employee_id, case when p_kind = 'in' then 'clock_in_by_guard' else 'clock_out_by_guard' end,
          jsonb_build_object('guard', v_guard, 'source', v_src, 'offline', v_offline, 'at', v_at, 'distance_m', round(v_dist::numeric)));
  return json_build_object('status', 'SUCCESS', 'kind', p_kind, 'at', v_at, 'name', w.name, 'hours', v_hours);
end $$;

/* ---------------- dashboard (Admin / HR / Dev only) ---------------- */
create or replace function private.moron_admin(p_token text) returns text
language plpgsql security definer set search_path = public, private as $$
declare v text := private.session_employee_id(p_token);
begin
  if not private.is_admin_role(v) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function public.dash_moron_data(p_token text) returns json
language plpgsql security definer set search_path = public, private as $$
declare v text := private.moron_admin(p_token);
begin
  return json_build_object(
    'guards', coalesce((select json_agg(json_build_object('id', e.employee_id, 'name', e.name, 'location', private.moron_loc(e.office_id),
        'locked', g.locked_until > now(),
        'workers', (select count(*) from private.moron_workers mw join public.employees x on x.employee_id = mw.employee_id
                     where x.office_id = e.office_id and x.status = 'Active')) order by e.name)
      from private.moron_guards g join public.employees e on e.employee_id = g.employee_id), '[]'::json),
    'workers', coalesce((select json_agg(json_build_object('id', e.employee_id, 'name', e.name, 'location', private.moron_loc(e.office_id),
        'active', e.status = 'Active', 'last', (select json_build_object('kind', l.kind, 'at', l.punch_at, 'source', l.source, 'offline', l.offline,
              'guard', (select name from public.employees where employee_id = l.guard))
            from private.moron_log l where l.worker = e.employee_id order by l.created_at desc limit 1)) order by private.moron_loc(e.office_id), e.name)
      from private.moron_workers mw join public.employees e on e.employee_id = mw.employee_id), '[]'::json),
    'staff', coalesce((select json_agg(json_build_object('id', e.employee_id, 'name', e.name, 'location', private.moron_loc(e.office_id),
        'is_guard', exists (select 1 from private.moron_guards g where g.employee_id = e.employee_id),
        'is_worker', exists (select 1 from private.moron_workers w where w.employee_id = e.employee_id)) order by private.moron_loc(e.office_id), e.name)
      from public.employees e where e.status = 'Active'), '[]'::json));
end $$;

create or replace function public.dash_moron_set_guard(p_token text, p_emp text, p_pin text) returns json
language plpgsql security definer set search_path = public, private, extensions as $$
declare v text := private.moron_admin(p_token);
begin
  if p_pin is null or p_pin !~ '^\d{4}$' then raise exception 'Moron PIN must be exactly 4 digits'; end if;
  if not exists (select 1 from public.employees where employee_id = p_emp and status = 'Active') then raise exception 'Employee not found'; end if;
  insert into private.moron_guards (employee_id, pin_hash, added_by) values (p_emp, crypt(p_pin, gen_salt('bf', 8)), v)
  on conflict (employee_id) do update set pin_hash = excluded.pin_hash, failed = 0, locked_until = null;
  delete from private.moron_keys where guard = p_emp;   -- new PIN = guard must unlock again
  insert into public.audit_log (employee_id, action, details) values (p_emp, 'moron_guard_set', jsonb_build_object('by', v));
  return json_build_object('ok', true);
end $$;

create or replace function public.dash_moron_remove_guard(p_token text, p_emp text) returns json
language plpgsql security definer set search_path = public, private as $$
declare v text := private.moron_admin(p_token);
begin
  delete from private.moron_guards where employee_id = p_emp;
  insert into public.audit_log (employee_id, action, details) values (p_emp, 'moron_guard_removed', jsonb_build_object('by', v));
  return json_build_object('ok', true);
end $$;

create or replace function public.dash_moron_set_worker(p_token text, p_emp text, p_on boolean) returns json
language plpgsql security definer set search_path = public, private as $$
declare v text := private.moron_admin(p_token);
begin
  if p_on then
    if not exists (select 1 from public.employees where employee_id = p_emp and status = 'Active') then raise exception 'Employee not found'; end if;
    insert into private.moron_workers (employee_id, added_by) values (p_emp, v) on conflict do nothing;
  else
    delete from private.moron_workers where employee_id = p_emp;
  end if;
  insert into public.audit_log (employee_id, action, details) values (p_emp, case when p_on then 'moron_worker_added' else 'moron_worker_removed' end, jsonb_build_object('by', v));
  return json_build_object('ok', true);
end $$;

revoke all on function private.moron_loc(uuid), private.moron_guard(text, text), private.moron_admin(text) from public, anon, authenticated;
revoke all on function public.moron_me(text), public.moron_unlock(text, text), public.moron_list(text, text),
  public.moron_punch(text, text, text, text, double precision, double precision, double precision, text, text, timestamptz),
  public.dash_moron_data(text), public.dash_moron_set_guard(text, text, text), public.dash_moron_remove_guard(text, text),
  public.dash_moron_set_worker(text, text, boolean) from public;
grant execute on function public.moron_me(text), public.moron_unlock(text, text), public.moron_list(text, text),
  public.moron_punch(text, text, text, text, double precision, double precision, double precision, text, text, timestamptz),
  public.dash_moron_data(text), public.dash_moron_set_guard(text, text, text), public.dash_moron_remove_guard(text, text),
  public.dash_moron_set_worker(text, text, boolean) to anon, authenticated;
