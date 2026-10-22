-- =====================================================================
-- Staffly dashboard (PC) - step 1: tables. Additive only; nothing existing is changed.
-- All objects live in the "private" schema (not reachable from the public API).
-- =====================================================================

create table if not exists private.dash_settings (
  id int primary key default 1 check (id = 1),
  data_start date not null default date '2026-09-14',   -- nothing before this date is calculated
  shift_hours numeric not null default 9,               -- hours above this = overtime
  late_in_after time not null default time '10:30',     -- In after this (to the minute) = late in
  late_out_from time not null default time '21:00',
  half_day_below numeric not null default 5,            -- worked under this (but >= half_day_min) = Half Day
  half_day_min numeric not null default 1
);
insert into private.dash_settings (id) values (1) on conflict do nothing;

create table if not exists private.dash_locations (
  name text primary key,
  sort int not null default 0
);
insert into private.dash_locations (name, sort) values ('Safdarjung HO', 1), ('Okhla', 2), ('Gurgaon', 3)
on conflict do nothing;

-- one row per Staffly employee: the extra facts the dashboard needs
create table if not exists private.dash_emp (
  employee_id text primary key references public.employees(employee_id) on delete cascade,
  dash_no bigint generated always as identity unique,   -- numeric id used by the dashboard screens
  location text not null default 'Safdarjung HO' references private.dash_locations(name) on update cascade,
  left_on date,                                         -- last working day
  in_only boolean not null default false,               -- only an In punch is needed
  no_auto_half_day boolean not null default false,      -- field staff: never auto Half Day
  tracked boolean not null default true,
  note text
);

create table if not exists private.dash_holidays (
  holiday_date date primary key,
  name text
);
insert into private.dash_holidays values (date '2026-10-02', 'Gandhi Jayanti') on conflict do nothing;

-- manual fixes; Staffly punches are never edited (history is kept: voided_at)
create table if not exists private.dash_corrections (
  id bigint generated always as identity primary key,
  employee_id text not null references public.employees(employee_id),
  work_date date not null,
  io text check (io in ('In','Out')),
  punch_time time,
  out_next_day boolean not null default false,
  status text check (status in ('Present','Absent','Half Day','Extra Day','Holiday')),
  night boolean not null default false,
  source text,
  remark text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  check ((io is null) = (punch_time is null)),
  constraint dash_corrections_has_content check (io is not null or status is not null or night or remark is not null)
);
create index if not exists dash_corrections_emp_date on private.dash_corrections (employee_id, work_date);

-- admin mode = password re-entered, valid 30 minutes, tied to the login session
create table if not exists private.dash_admin_elev (
  token_hash bytea primary key,
  employee_id text not null,
  expires_at timestamptz not null
);

-- optional salary preview data (fill by SQL; see notes)
create table if not exists private.dash_salary (
  employee_id text primary key references public.employees(employee_id) on delete cascade,
  monthly_salary numeric not null check (monthly_salary >= 0)
);

alter table private.dash_settings   enable row level security;
alter table private.dash_locations  enable row level security;
alter table private.dash_emp        enable row level security;
alter table private.dash_holidays   enable row level security;
alter table private.dash_corrections enable row level security;
alter table private.dash_admin_elev enable row level security;
alter table private.dash_salary     enable row level security;

-- keep the dashboard roster in step with Staffly employees
create or replace function private.dash_sync() returns void
language sql security definer set search_path = public, private, extensions as $$
  insert into private.dash_emp (employee_id)
  select e.employee_id from public.employees e
  where not exists (select 1 from private.dash_emp m where m.employee_id = e.employee_id);
$$;
select private.dash_sync();
update private.dash_emp set in_only = true, note = 'In only (no Out needed)'
 where employee_id in (select employee_id from public.employees where lower(btrim(name)) = 'raj');
