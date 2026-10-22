-- Staffly step 3: three offices, all 150 m, and punch-in/out checks the employee's own office.

-- 1) offices (Safdarjung changes 500 m -> 150 m)
update public.offices set radius_m = 150 where id = '11111111-1111-1111-1111-111111111111';

insert into public.offices (name, address, lat, lng, radius_m)
select 'DDC Okhla', 'C-35, Pocket C, Okhla Phase I, New Delhi 110020', 28.5277469, 77.279788, 150
where not exists (select 1 from public.offices where name = 'DDC Okhla');

insert into public.offices (name, address, lat, lng, radius_m)
select 'DDC Gurgaon', '549D, Sector 37, Gurugram 122006', 28.4390653, 76.9969774, 150
where not exists (select 1 from public.offices where name = 'DDC Gurgaon');

-- 2) clock_in: geofence = the employee's own office (falls back to Safdarjung if none set)
create or replace function private.clock_in(p_employee_id text, p_lat double precision, p_lng double precision, p_accuracy double precision default null)
returns json language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  v_office_lat double precision; v_office_lng double precision; v_allowed_radius_m double precision;
  v_grace_time time := '11:15:00';
  v_now_ist timestamp := current_timestamp at time zone 'Asia/Kolkata';
  v_today date := (current_timestamp at time zone 'Asia/Kolkata')::date;
  v_dist_m double precision; v_effective double precision; v_status text;
  v_row public.attendance%rowtype; v_done boolean := false;
  v_anywhere boolean := private.can_punch_anywhere(p_employee_id);
  v_outside boolean;
begin
  select o.lat, o.lng, o.radius_m into v_office_lat, v_office_lng, v_allowed_radius_m
    from public.offices o
   where o.id = coalesce((select e.office_id from public.employees e where e.employee_id = p_employee_id),
                         '11111111-1111-1111-1111-111111111111'::uuid);
  if v_office_lat is null then
    select o.lat, o.lng, o.radius_m into v_office_lat, v_office_lng, v_allowed_radius_m
      from public.offices o where o.id = '11111111-1111-1111-1111-111111111111';
  end if;

  v_dist_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_office_lat) / 2), 2) +
      cos(radians(v_office_lat)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - v_office_lng) / 2), 2)));

  if v_dist_m is null then return json_build_object('status', 'NO_LOCATION'); end if;

  v_effective := greatest(0, v_dist_m - least(coalesce(p_accuracy, 0), 100));
  v_outside   := v_effective > v_allowed_radius_m;
  if v_outside and not v_anywhere then
    return json_build_object('status', 'OUT_OF_RANGE', 'distance_m', v_dist_m);
  end if;

  v_status := case when v_now_ist::time > v_grace_time then 'Late' else 'Present' end;

  insert into public.attendance (employee_id, work_date, clock_in_time, clock_in_lat, clock_in_lng, distance_m, status)
  values (p_employee_id, v_today, current_timestamp, p_lat, p_lng, v_dist_m, v_status)
  on conflict (employee_id, work_date) do nothing;
  v_done := found;

  if not v_done then
    select * into v_row from public.attendance where employee_id = p_employee_id and work_date = v_today for update;
    if v_row.clock_out_time is not null then
      return json_build_object('status', 'ALREADY_CLOCKED_OUT', 'clock_in_time', v_row.clock_in_time, 'clock_out_time', v_row.clock_out_time);
    elsif v_row.clock_in_time is not null then
      return json_build_object('status', 'ALREADY_CLOCKED_IN', 'clock_in_time', v_row.clock_in_time);
    end if;
    update public.attendance
       set clock_in_time = current_timestamp, clock_in_lat = p_lat, clock_in_lng = p_lng, distance_m = v_dist_m, status = v_status
     where employee_id = p_employee_id and work_date = v_today and clock_in_time is null;
  end if;

  if v_outside then
    insert into public.audit_log (employee_id, action, details)
    values (p_employee_id, 'clock_in_anywhere', jsonb_build_object('lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy, 'distance_m', round(v_dist_m::numeric)));
  end if;

  return json_build_object('status', 'SUCCESS', 'distance_m', v_dist_m, 'attendance_status', v_status, 'anywhere', v_outside);
end $function$;

-- 3) clock_out: same
create or replace function private.clock_out(p_employee_id text, p_lat double precision, p_lng double precision, p_accuracy double precision default null)
returns json language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  v_office_lat double precision; v_office_lng double precision; v_allowed_radius_m double precision;
  v_required_hours numeric := 9.0; v_grace_time time := '11:15:00';
  v_today date := (current_timestamp at time zone 'Asia/Kolkata')::date;
  v_dist_m double precision; v_effective double precision; v_clock_in timestamptz;
  v_hours numeric; v_status text; v_complete boolean;
  v_anywhere boolean := private.can_punch_anywhere(p_employee_id);
  v_outside boolean;
begin
  select o.lat, o.lng, o.radius_m into v_office_lat, v_office_lng, v_allowed_radius_m
    from public.offices o
   where o.id = coalesce((select e.office_id from public.employees e where e.employee_id = p_employee_id),
                         '11111111-1111-1111-1111-111111111111'::uuid);
  if v_office_lat is null then
    select o.lat, o.lng, o.radius_m into v_office_lat, v_office_lng, v_allowed_radius_m
      from public.offices o where o.id = '11111111-1111-1111-1111-111111111111';
  end if;

  v_dist_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_office_lat) / 2), 2) +
      cos(radians(v_office_lat)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - v_office_lng) / 2), 2)));

  if v_dist_m is null then return json_build_object('status', 'NO_LOCATION'); end if;

  v_effective := greatest(0, v_dist_m - least(coalesce(p_accuracy, 0), 100));
  v_outside   := v_effective > v_allowed_radius_m;
  if v_outside and not v_anywhere then
    return json_build_object('status', 'OUT_OF_RANGE', 'distance_m', v_dist_m,
      'message', 'Punch Out not matching with Punch In location or not under ' || round(v_allowed_radius_m)::text || 'm, hence Punch Out pending and 9 hours shift not completed.');
  end if;

  select clock_in_time into v_clock_in from public.attendance
   where employee_id = p_employee_id and work_date = v_today for update;
  if v_clock_in is null then return json_build_object('status', 'NO_CLOCK_IN'); end if;

  v_hours    := round(extract(epoch from (current_timestamp - v_clock_in)) / 3600.0, 2);
  v_complete := v_hours >= v_required_hours;
  v_status   := case when v_hours < v_required_hours / 2 then 'Half Day'
                     when (v_clock_in at time zone 'Asia/Kolkata')::time > v_grace_time then 'Late'
                     else 'Present' end;

  update public.attendance
     set clock_out_time = current_timestamp, clock_out_lat = p_lat, clock_out_lng = p_lng,
         distance_m = v_dist_m, hours_worked = v_hours, status = v_status
   where employee_id = p_employee_id and work_date = v_today;

  if v_outside then
    insert into public.audit_log (employee_id, action, details)
    values (p_employee_id, 'clock_out_anywhere', jsonb_build_object('lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy, 'distance_m', round(v_dist_m::numeric)));
  end if;

  return json_build_object('status', 'SUCCESS', 'distance_m', v_dist_m, 'hours_worked', v_hours,
    'attendance_status', v_status, 'shift_complete', v_complete, 'anywhere', v_outside,
    'shift_message', case when v_complete then 'Shift Complete - 9 hours fulfilled.'
                          else 'Shift Incomplete - only ' || v_hours::text || ' of 9 hours completed.' end);
end $function$;
