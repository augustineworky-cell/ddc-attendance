-- 19: Guardian punch (v103). Raj (DCC204) does not use the app; Ignatius Lakra (DCC202) is his guardian.
-- Before Ignatius's own Punch In / Punch Out, the app asks "Raj aayal hai?" - Yes punches Raj too (same rules as a normal punch:
-- inside Raj's office radius, or on the office Wi-Fi), No does nothing (Raj stays absent / no out).
create table if not exists private.punch_guardians (
  ward     text primary key references public.employees(employee_id) on delete cascade,
  guardian text not null references public.employees(employee_id) on delete cascade,
  added_at timestamptz not null default now()
);
revoke all on private.punch_guardians from public, anon, authenticated;
insert into private.punch_guardians (ward, guardian) values ('DCC204', 'DCC202') on conflict (ward) do update set guardian = excluded.guardian;

create or replace function public.guardian_wards(p_token text) returns json
language plpgsql security definer set search_path = public, private, extensions as $$
declare v text := private.session_employee_id(p_token); v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  return coalesce((select json_agg(json_build_object('id', e.employee_id, 'name', e.name, 'in', a.clock_in_time, 'out', a.clock_out_time) order by e.name)
    from private.punch_guardians pg join public.employees e on e.employee_id = pg.ward and e.status = 'Active'
    left join public.attendance a on a.employee_id = e.employee_id and a.work_date = v_today
   where pg.guardian = v), '[]'::json);
end $$;

create or replace function public.guardian_punch(p_token text, p_ward text, p_kind text,
  p_lat double precision, p_lng double precision, p_accuracy double precision default null) returns json
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v text := private.session_employee_id(p_token);
  v_ip inet := private.request_ip(); v_office boolean := private.is_office_ip(v_ip);
  v_res json; v_hq record;
begin
  if p_kind not in ('in', 'out') then return json_build_object('status', 'BAD_REQUEST'); end if;
  if not exists (select 1 from private.punch_guardians where ward = p_ward and guardian = v) then
    return json_build_object('status', 'NOT_ALLOWED');
  end if;
  if p_lat is not null and p_lng is not null then
    v_res := case when p_kind = 'in' then private.clock_in(p_ward, p_lat, p_lng, p_accuracy) else private.clock_out(p_ward, p_lat, p_lng, p_accuracy) end;
  end if;
  if (v_res is null or coalesce(v_res->>'status', '') = 'OUT_OF_RANGE') and v_office then
    select * into v_hq from private.office_point_for(p_ward);
    v_res := case when p_kind = 'in' then private.clock_in(p_ward, v_hq.lat, v_hq.lng, 0) else private.clock_out(p_ward, v_hq.lat, v_hq.lng, 0) end;
  end if;
  if v_res is null then v_res := json_build_object('status', 'NO_LOCATION'); end if;
  insert into public.audit_log (employee_id, action, details)
  values (p_ward, case when p_kind = 'in' then 'clock_in_by_guardian' else 'clock_out_by_guardian' end,
          jsonb_build_object('guardian', v, 'status', v_res->>'status', 'office_wifi', v_office, 'lat', p_lat, 'lng', p_lng));
  return v_res;
end $$;

revoke all on function public.guardian_wards(text), public.guardian_punch(text, text, text, double precision, double precision, double precision) from public;
grant execute on function public.guardian_wards(text), public.guardian_punch(text, text, text, double precision, double precision, double precision) to anon, authenticated;

-- v104 (applied as migration staffly_guardian_backup): backup guardian on the PC dashboard.
-- punch_guardians.backup = 'EMP101' for Raj. If the main guardian (Ignatius) has no Punch In by 10:00 India time,
-- the backup is "on duty": guardian_backup_due(token) lists the wards, and guardian_punch accepts the backup too.
-- See private.guardian_backup_on(ward, caller) in Supabase for the exact rule.
