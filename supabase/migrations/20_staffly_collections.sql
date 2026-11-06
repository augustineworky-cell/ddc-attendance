-- 20: Collection visits (replaces the Jotform "Form" used by field payment collectors).
-- Phone app: a field collector (dash_emp location 'Payment Collector HO', or a Dev for testing) opens "Collection visit",
-- records party, received / not received, mode, amount, full / part invoice, shop photo and GPS. Works offline (sent later).
-- PC dashboard: Admin / HR / Dev and the viewers in private.coll_viewers (Supriya) see every visit. View only.

create table if not exists private.coll_viewers (
  employee_id text primary key references public.employees(employee_id) on delete cascade
);
insert into private.coll_viewers values ('DCC208') on conflict do nothing;   -- Supriya Singh

create table if not exists private.coll_visits (
  id           bigserial primary key,
  client_id    text unique,                       -- made on the phone, stops a double send of an offline visit
  employee_id  text not null references public.employees(employee_id),
  visit_at     timestamptz not null,
  visit_date   date not null,
  result       text not null check (result in ('received', 'not_received')),
  party        text not null,
  place        text,
  reason       text,
  mode         text check (mode in ('Cash', 'Cheque', 'UPI', 'NEFT/RTGS')),
  amount       numeric(14,2),
  invoice      text check (invoice in ('full', 'part')),
  photo_url    text not null,
  photo_source text,
  lat double precision, lng double precision, accuracy double precision,
  offline      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists coll_visits_date_idx on private.coll_visits (visit_date desc, employee_id);
revoke all on private.coll_viewers, private.coll_visits from public, anon, authenticated;

create or replace function private.coll_is_collector(p_emp text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.dash_emp m where m.employee_id = p_emp and m.location = 'Payment Collector HO' and m.left_on is null)
      or exists (select 1 from public.employees e where e.employee_id = p_emp and e.role = 'Dev')
$$;
create or replace function private.coll_can_view(p_emp text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select private.is_admin_role(p_emp) or exists (select 1 from private.coll_viewers v where v.employee_id = p_emp)
$$;

/* ---------------- phone app ---------------- */
create or replace function public.coll_me(p_token text) returns json
language plpgsql security definer set search_path = public, private as $$
declare v_emp text := private.session_employee_id(p_token); v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not private.coll_is_collector(v_emp) then return json_build_object('is_collector', false); end if;
  return json_build_object('is_collector', true, 'today', v_today,
    'visits', coalesce((select json_agg(json_build_object('id', c.client_id, 'at', c.visit_at, 'result', c.result, 'party', c.party,
                 'place', c.place, 'mode', c.mode, 'amount', c.amount, 'invoice', c.invoice, 'reason', c.reason) order by c.visit_at desc)
               from private.coll_visits c where c.employee_id = v_emp and c.visit_date = v_today), '[]'::json),
    'parties', coalesce((select json_agg(json_build_object('party', p.party, 'place', p.place) order by p.last desc)
               from (select distinct on (lower(party)) party, place, visit_at as last from private.coll_visits
                      where visit_date > v_today - 120 order by lower(party), visit_at desc) p), '[]'::json));
end $$;

create or replace function public.coll_add(p_token text, p_client_id text, p_result text, p_party text, p_place text,
  p_reason text, p_mode text, p_amount numeric, p_invoice text, p_photo_path text, p_source text,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_at timestamptz default null) returns json
language plpgsql security definer set search_path = public, private as $$
declare
  v_emp text := private.session_employee_id(p_token); v_now timestamptz := now(); v_at timestamptz; v_date date;
  v_prefix text := 'https://bpwpxhsdmbkymhpjsfej.supabase.co/storage/v1/object/public/attendance-media/';
  v_party text := nullif(btrim(regexp_replace(coalesce(p_party, ''), '\s+', ' ', 'g')), '');
begin
  if not private.coll_is_collector(v_emp) then return json_build_object('status', 'NOT_ALLOWED'); end if;
  if p_client_id is null or p_client_id !~ '^[a-f0-9]{16,40}$' then return json_build_object('status', 'BAD_REQUEST'); end if;
  if exists (select 1 from private.coll_visits where client_id = p_client_id) then return json_build_object('status', 'SUCCESS', 'duplicate', true); end if;
  if p_result not in ('received', 'not_received') then return json_build_object('status', 'BAD_REQUEST'); end if;
  if v_party is null or length(v_party) > 150 then return json_build_object('status', 'NO_PARTY'); end if;
  if p_result = 'received' then
    if p_mode is null or p_mode not in ('Cash', 'Cheque', 'UPI', 'NEFT/RTGS') then return json_build_object('status', 'NO_MODE'); end if;
    if p_amount is null or p_amount <= 0 or p_amount > 100000000 then return json_build_object('status', 'NO_AMOUNT'); end if;
    if p_invoice is null or p_invoice not in ('full', 'part') then return json_build_object('status', 'NO_INVOICE'); end if;
  elsif nullif(btrim(coalesce(p_reason, '')), '') is null then return json_build_object('status', 'NO_REASON');
  end if;

  v_at := coalesce(p_at, v_now);
  if v_at > v_now + interval '2 minutes' then v_at := v_now; end if;
  if v_at < v_now - interval '72 hours' then return json_build_object('status', 'TOO_OLD'); end if;
  v_date := (v_at at time zone 'Asia/Kolkata')::date;

  if p_photo_path is null or p_photo_path not like 'collections/' || v_emp || '\_%'
     or not exists (select 1 from storage.objects where bucket_id = 'attendance-media' and name = p_photo_path) then
    return json_build_object('status', 'PHOTO_MISSING');
  end if;

  insert into private.coll_visits (client_id, employee_id, visit_at, visit_date, result, party, place, reason, mode, amount, invoice,
         photo_url, photo_source, lat, lng, accuracy, offline)
  values (p_client_id, v_emp, v_at, v_date, p_result, v_party, nullif(btrim(left(coalesce(p_place, ''), 250)), ''),
          case when p_result = 'not_received' then btrim(left(p_reason, 500)) else nullif(btrim(left(coalesce(p_reason, ''), 500)), '') end,
          case when p_result = 'received' then p_mode end, case when p_result = 'received' then round(p_amount, 2) end,
          case when p_result = 'received' then p_invoice end,
          v_prefix || p_photo_path, case when p_source = 'gallery' then 'gallery' else 'camera' end,
          p_lat, p_lng, p_accuracy, p_at is not null and p_at < v_now - interval '2 minutes')
  on conflict (client_id) do nothing;
  return json_build_object('status', 'SUCCESS', 'at', v_at);
end $$;

/* ---------------- PC dashboard (view only) ---------------- */
create or replace function public.dash_coll_me(p_token text) returns json
language plpgsql security definer set search_path = public, private as $$
declare v text := private.session_employee_id(p_token);
begin
  return json_build_object('can_view', private.coll_can_view(v));
end $$;

create or replace function public.dash_coll_data(p_token text, p_from date, p_to date) returns json
language plpgsql security definer set search_path = public, private as $$
declare v text := private.session_employee_id(p_token);
begin
  if not private.coll_can_view(v) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'Pick a date range up to 400 days'; end if;
  return json_build_object('today', (now() at time zone 'Asia/Kolkata')::date,
    'collectors', coalesce((select json_agg(json_build_object('id', e.employee_id, 'name', e.name) order by e.name)
        from public.employees e where e.status = 'Active' and private.coll_is_collector(e.employee_id)
          and (exists (select 1 from private.dash_emp m where m.employee_id = e.employee_id and m.location = 'Payment Collector HO')
               or exists (select 1 from private.coll_visits c where c.employee_id = e.employee_id))), '[]'::json),
    'rows', coalesce((select json_agg(json_build_object('at', c.visit_at, 'd', c.visit_date, 'emp', c.employee_id, 'name', e.name,
        'result', c.result, 'party', c.party, 'place', c.place, 'reason', c.reason, 'mode', c.mode, 'amount', c.amount,
        'invoice', c.invoice, 'photo', c.photo_url, 'src', c.photo_source, 'lat', c.lat, 'lng', c.lng, 'acc', round(c.accuracy::numeric),
        'offline', c.offline) order by c.visit_at desc)
      from private.coll_visits c join public.employees e on e.employee_id = c.employee_id
      where c.visit_date between p_from and p_to), '[]'::json));
end $$;

-- photo upload from the phone: collections/<EMP>_<yyyy-mm-dd>_<13 digit ms>_<16 hex>.webp
drop policy if exists staffly_coll_upload on storage.objects;
create policy staffly_coll_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'attendance-media' and name ~ '^collections/[A-Za-z0-9-]+_\d{4}-\d{2}-\d{2}_\d{13}_[a-f0-9]{16}\.webp$');

revoke all on function private.coll_is_collector(text), private.coll_can_view(text) from public, anon, authenticated;
revoke all on function public.coll_me(text),
  public.coll_add(text, text, text, text, text, text, text, numeric, text, text, text, double precision, double precision, double precision, timestamptz),
  public.dash_coll_me(text), public.dash_coll_data(text, date, date) from public;
grant execute on function public.coll_me(text),
  public.coll_add(text, text, text, text, text, text, text, numeric, text, text, text, double precision, double precision, double precision, timestamptz),
  public.dash_coll_me(text), public.dash_coll_data(text, date, date) to anon, authenticated;
