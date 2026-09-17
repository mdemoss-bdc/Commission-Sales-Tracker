export const PAY_TRACKER_STATE_TABLE = "pay_tracker_state";
export const PAY_TRACKER_STATE_SELECT =
  "id,user_id,employee_id,month_id,status,state,admin_pushed_snapshot,rep_draft,approval_diffs,pay_delta,finalized_label,deny_reason,location_id,created_by,created_at,updated_at";
export const ADMIN_EMPLOYEE_SHEETS_TABLE = "admin_employee_sheets";
export const ADMIN_EMPLOYEE_SHEET_SELECT =
  "employee_id,org_id,location_id,month_id,period_key,sheet_data,status,created_by,created_at,updated_at,paid_at,is_paid";
export const ADMIN_EMPLOYEE_SHEET_SELECT_MIN =
  "employee_id,org_id,location_id,month_id,period_key,sheet_data,status,created_by,created_at,updated_at";
export const LOCATIONS_TABLE = "locations";
export const ORGANIZATIONS_TABLE = "organizations";
export const USER_PROFILES_TABLE = "user_profiles";
export const CUSTOM_ROLES_TABLE = "custom_roles";
export const DEAL_RECORDS_TABLE = "deal_records";
export const USER_NOTIFICATIONS_TABLE = "user_notifications";

export const LOCATION_SELECT = "id, name, created_at, org_id";
export const LOCATION_SELECT_MIN = "id, name, created_at";
export const ORGANIZATION_SELECT = "id,name,join_code,pay_tiers";
export const ORGANIZATION_SELECT_MIN = "id,name,join_code";
export const DEAL_RECORD_SELECT_MIN =
  "id, rep_id, location_id, created_by, status, staged_data, live_data, rep_notes, manager_notes, reject_reason, created_at, updated_at";
export const DEAL_RECORD_SELECT_WITH_PROPOSED = `${DEAL_RECORD_SELECT_MIN}, proposed_data`;
export const DEAL_RECORD_SELECT = `${DEAL_RECORD_SELECT_WITH_PROPOSED}, previous_data`;
export const USER_PROFILE_SELECT_MIN = "id,email,full_name,role,location_id";
export const USER_PROFILE_SELECT_READY = `${USER_PROFILE_SELECT_MIN},roster_ready`;
export const USER_PROFILE_SELECT_ORG = `${USER_PROFILE_SELECT_READY},org_id`;
export const USER_PROFILE_SELECT = `${USER_PROFILE_SELECT_ORG},custom_role_id`;

export const SUPABASE_SETUP_SQL = `-- FOUND_ROW_SCHEMA
-- Pay Tracker org, roles, and staged/live deals
-- Run in the Supabase SQL editor. Safe to re-run.
-- Copy the entire file. Do not split inside a function body.
-- If the first line is not FOUND_ROW_SCHEMA, this is the wrong copy.

-- 1. Locations
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

alter table public.locations add column if not exists active boolean not null default true;

insert into public.locations (name)
select seed.name
from (
  values
    ('Cadillac'),
    ('Ford / BMW'),
    ('Honda / Volkswagen'),
    ('Morgantown'),
    ('Nissan'),
    ('Supercenter'),
    ('Toyota / Lexus'),
    ('Used Ford')
) as seed(name)
where not exists (
  select 1 from public.locations existing where existing.name = seed.name
);

-- 1b. Dealership group (join code + rooftops)
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null,
  created_at timestamptz default now()
);

create unique index if not exists organizations_join_code_upper_idx
  on public.organizations (upper(join_code));

create unique index if not exists organizations_name_lower_idx
  on public.organizations (lower(trim(name)));

alter table public.organizations add column if not exists pay_tiers jsonb not null default '[
  {"min":0,"max":3,"rate":0.2},
  {"min":4,"max":7,"rate":0.25},
  {"min":8,"max":11,"rate":0.3},
  {"min":12,"max":null,"rate":0.35}
]'::jsonb;

alter table public.organizations add column if not exists created_by uuid;

update public.organizations
set pay_tiers = '[
  {"min":0,"max":3,"rate":0.2},
  {"min":4,"max":7,"rate":0.25},
  {"min":8,"max":11,"rate":0.3},
  {"min":12,"max":null,"rate":0.35}
]'::jsonb
where pay_tiers is null or pay_tiers = '[]'::jsonb;

alter table public.locations add column if not exists org_id uuid references public.organizations(id) on delete set null;

insert into public.organizations (name, join_code)
select 'Moses', 'MOSES'
where not exists (select 1 from public.organizations);

update public.locations
set org_id = (select id from public.organizations order by created_at limit 1)
where org_id is null;

drop trigger if exists locations_default_org on public.locations;
drop function if exists public.locations_default_org();
create or replace function public.locations_default_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.org_id is null then
    new.org_id := public.current_org_id();
  end if;
  return new;
end;
$$;

drop trigger if exists locations_default_org on public.locations;
create trigger locations_default_org
  before insert on public.locations
  for each row execute procedure public.locations_default_org();

-- 2. User profiles (role + location)
do $$ begin
  create type public.user_role as enum ('admin', 'manager', 'rep');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'rep',
  location_id uuid references public.locations(id) on delete set null,
  roster_ready boolean not null default false,
  created_at timestamptz default now()
);

-- Multiple admins are allowed. Any admin may promote another user to admin
-- without demoting themselves.
drop index if exists public.single_admin_idx;

alter table public.user_profiles add column if not exists roster_ready boolean not null default false;
alter table public.user_profiles add column if not exists org_id uuid references public.organizations(id) on delete set null;

create table if not exists public.custom_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create unique index if not exists custom_roles_org_name_lower_idx
  on public.custom_roles (org_id, lower(trim(name)));

alter table public.user_profiles
  add column if not exists custom_role_id uuid references public.custom_roles(id) on delete set null;

alter table public.custom_roles enable row level security;

-- 3. Staged and live tracker records
do $$ begin
  create type public.record_status as enum (
    'active',
    'draft',
    'staged',
    'pending_rep_review',
    'awaiting_review',
    'pushed',
    'pending_manager_approval',
    'pending_admin_approval',
    'approved',
    'rejected'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'draft';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'pending_rep_review';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'pending_admin_approval';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'awaiting_review';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'pushed';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'admin_pushed';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'rep_accepted_no_changes';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'rep_modified';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'manager_approved';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'rep_authorized_no_changes';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'admin_final_approved';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter type public.record_status add value if not exists 'rejected_by_manager';
exception
  when duplicate_object then null;
end $$;

create table if not exists public.deal_records (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.user_profiles(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  created_by uuid not null references public.user_profiles(id),
  status public.record_status not null default 'active',
  staged_data jsonb default '{}'::jsonb,
  live_data jsonb not null default '{}'::jsonb,
  proposed_data jsonb default null,
  previous_data jsonb not null default '{}'::jsonb,
  rep_notes text,
  reject_reason text,
  updated_at timestamptz default now()
);

create index if not exists deal_records_rep_idx on public.deal_records (rep_id);
create index if not exists deal_records_location_status_idx on public.deal_records (location_id, status);

alter table public.deal_records add column if not exists proposed_data jsonb default null;
alter table public.deal_records alter column proposed_data drop not null;
alter table public.deal_records add column if not exists previous_data jsonb not null default '{}'::jsonb;
alter table public.deal_records add column if not exists reject_reason text;
alter table public.deal_records add column if not exists manager_notes text;
alter table public.deal_records add column if not exists created_at timestamptz default now();
alter table public.deal_records add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.deal_records add column if not exists rep_notes text;

-- Pushed worksheet snapshot for the sales-rep view (one row per employee).
create table if not exists public.pay_tracker_state (
  id uuid primary key references public.user_profiles(id) on delete cascade,
  state jsonb not null default '{}'::jsonb
);

alter table public.pay_tracker_state add column if not exists user_id uuid references public.user_profiles(id) on delete cascade;
alter table public.pay_tracker_state add column if not exists employee_id uuid references public.user_profiles(id) on delete cascade;
alter table public.pay_tracker_state add column if not exists month_id text;
alter table public.pay_tracker_state add column if not exists status text not null default 'awaiting_review';
alter table public.pay_tracker_state add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.pay_tracker_state add column if not exists created_by uuid references public.user_profiles(id);
alter table public.pay_tracker_state add column if not exists created_at timestamptz not null default now();
alter table public.pay_tracker_state add column if not exists updated_at timestamptz not null default now();
alter table public.pay_tracker_state add column if not exists admin_pushed_snapshot jsonb;
alter table public.pay_tracker_state add column if not exists rep_draft jsonb;
alter table public.pay_tracker_state add column if not exists approval_diffs jsonb not null default '[]'::jsonb;
alter table public.pay_tracker_state add column if not exists pay_delta numeric not null default 0;
alter table public.pay_tracker_state add column if not exists finalized_label text;
alter table public.pay_tracker_state add column if not exists deny_reason text;

alter table public.deal_records add column if not exists admin_pushed_snapshot jsonb;

update public.pay_tracker_state
set
  user_id = coalesce(user_id, id),
  employee_id = coalesce(employee_id, id)
where user_id is null or employee_id is null;

create index if not exists pay_tracker_state_employee_idx
  on public.pay_tracker_state (employee_id, status, updated_at desc);
create index if not exists pay_tracker_state_user_idx
  on public.pay_tracker_state (user_id, status, updated_at desc);

-- Isolated admin master ledger. One row per employee. Reps never read this table.
create table if not exists public.admin_employee_sheets (
  employee_id uuid primary key references public.user_profiles(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  month_id text,
  sheet_data jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  is_paid boolean not null default false,
  paid_at timestamptz,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_employee_sheets add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.admin_employee_sheets add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.admin_employee_sheets add column if not exists month_id text;
alter table public.admin_employee_sheets add column if not exists period_key text;
alter table public.admin_employee_sheets add column if not exists sheet_data jsonb not null default '{}'::jsonb;
alter table public.admin_employee_sheets add column if not exists status text not null default 'draft';
alter table public.admin_employee_sheets add column if not exists is_paid boolean not null default false;
alter table public.admin_employee_sheets add column if not exists paid_at timestamptz;
alter table public.admin_employee_sheets add column if not exists created_by uuid references public.user_profiles(id);
alter table public.admin_employee_sheets add column if not exists created_at timestamptz not null default now();
alter table public.admin_employee_sheets add column if not exists updated_at timestamptz not null default now();

-- One admin master row per employee + pay period (period_key). Migrate from employee-only PK.
update public.admin_employee_sheets
set period_key = coalesce(nullif(period_key, ''), nullif(month_id, ''), 'legacy')
where period_key is null or period_key = '';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.admin_employee_sheets'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (employee_id)'
  ) then
    alter table public.admin_employee_sheets drop constraint admin_employee_sheets_pkey;
  end if;
exception when undefined_table then
  null;
end $$;

alter table public.admin_employee_sheets alter column period_key set default 'legacy';
update public.admin_employee_sheets set period_key = 'legacy' where period_key is null or period_key = '';
alter table public.admin_employee_sheets alter column period_key set not null;

create unique index if not exists admin_employee_sheets_employee_period_uidx
  on public.admin_employee_sheets (employee_id, period_key);

create index if not exists admin_employee_sheets_org_idx
  on public.admin_employee_sheets (org_id, status, updated_at desc);
create index if not exists admin_employee_sheets_location_idx
  on public.admin_employee_sheets (location_id, status);

-- Enable RLS
alter table public.locations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.deal_records enable row level security;
alter table public.organizations enable row level security;
alter table public.pay_tracker_state enable row level security;
alter table public.admin_employee_sheets enable row level security;

-- Role helpers (security definer so policies do not recurse)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

drop function if exists public.is_manager();
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'manager'
  );
$$;

drop function if exists public.current_location_id();
create or replace function public.current_location_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select location_id from public.user_profiles where id = auth.uid();
$$;

-- True when the signed-in manager's rooftop owns this employee (preferred)
-- or the deal is stamped to that rooftop and the employee is not assigned elsewhere.
drop function if exists public.manager_covers_deal(uuid, uuid);
create or replace function public.manager_covers_deal(deal_location uuid, deal_rep uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_manager()
    and public.current_location_id() is not null
    and (
      exists (
        select 1
        from public.user_profiles p
        where p.id = deal_rep
          and p.location_id = public.current_location_id()
      )
      or (
        deal_location = public.current_location_id()
        and not exists (
          select 1
          from public.user_profiles p
          where p.id = deal_rep
            and p.location_id is not null
            and p.location_id is distinct from public.current_location_id()
        )
      )
    );
$$;

drop function if exists public.current_org_id();
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select org_id from public.user_profiles where id = auth.uid()),
    (
      select loc.org_id
      from public.user_profiles profile
      join public.locations loc on loc.id = profile.location_id
      where profile.id = auth.uid()
    ),
    (
      select id
      from public.organizations
      where created_by = auth.uid()
      order by created_at
      limit 1
    )
  );
$$;

drop function if exists public.get_current_dealership();
create or replace function public.get_current_dealership()
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row organizations%rowtype;
  org uuid;
begin
  if auth.uid() is null then
    return null;
  end if;

  org := public.current_org_id();
  if org is not null then
    select * into found_row from public.organizations where id = org;
  end if;

  if found_row.id is null then
    select * into found_row
    from public.organizations
    where created_by = auth.uid()
    order by created_at
    limit 1;
  end if;

  if found_row.id is null and public.is_admin() then
    select * into found_row
    from public.organizations
    order by created_at
    limit 1;
  end if;

  if found_row.id is null then
    return null;
  end if;

  update public.user_profiles
  set org_id = found_row.id
  where id = auth.uid()
    and org_id is null;

  return found_row;
end;
$$;

drop trigger if exists locations_default_org on public.locations;
create trigger locations_default_org
  before insert on public.locations
  for each row execute procedure public.locations_default_org();

update public.user_profiles p
set org_id = loc.org_id
from public.locations loc
where p.location_id = loc.id
  and p.org_id is null
  and loc.org_id is not null;

update public.user_profiles
set org_id = (select id from public.organizations where upper(join_code) = 'MOSES' limit 1)
where org_id is null
  and lower(email) = 'matthewdemoss@mosescars.com';

-- Signup with a dealership join code (or any chosen rooftop) is always a
-- sales rep. Registering a new dealership group is always an admin for that
-- org. Never promote the first store user to admin on join-code signup.
drop function if exists public.ensure_own_profile();
drop function if exists public.ensure_own_profile(uuid);
create or replace function public.ensure_own_profile(selected_location_id uuid default null)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  profile user_profiles%rowtype;
  meta_name text;
  meta_location uuid;
  loc_text text;
  signup_mode text;
  chosen uuid;
  chosen_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'full_name', '')), ''),
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'location_id', auth.jwt() -> 'user_metadata' ->> 'location_id', '')), ''),
    lower(nullif(trim(coalesce(u.raw_user_meta_data ->> 'signup_mode', auth.jwt() -> 'user_metadata' ->> 'signup_mode', '')), ''))
  into meta_name, loc_text, signup_mode
  from auth.users u
  where u.id = auth.uid();

  meta_location := null;
  if loc_text is not null then
    begin
      meta_location := loc_text::uuid;
    exception
      when invalid_text_representation then
        meta_location := null;
    end;
  end if;

  chosen := selected_location_id;
  if chosen is null then
    chosen := meta_location;
  end if;
  if chosen is not null and not exists (
    select 1 from public.locations where id = chosen and active = true
  ) then
    chosen := null;
  end if;

  chosen_org := null;
  if chosen is not null then
    select org_id into chosen_org from public.locations where id = chosen;
  end if;

  select * into profile from public.user_profiles where id = auth.uid();
  if found then
    if lower(coalesce(profile.email, '')) = 'matthewdemoss@mosescars.com' and profile.role is distinct from 'admin' then
      update public.user_profiles
      set role = 'admin'
      where id = auth.uid()
      returning * into profile;
    end if;
    if signup_mode = 'new_dealership' and profile.role is distinct from 'admin' then
      update public.user_profiles
      set role = 'admin'
      where id = auth.uid()
      returning * into profile;
    end if;
    if (profile.location_id is null and chosen is not null) or (profile.org_id is null and chosen_org is not null) then
      update public.user_profiles
      set
        location_id = coalesce(profile.location_id, chosen),
        org_id = coalesce(profile.org_id, chosen_org),
        full_name = coalesce(nullif(trim(profile.full_name), ''), meta_name, profile.full_name)
      where id = auth.uid()
      returning * into profile;
    elsif meta_name is not null and (
      profile.full_name is null
      or trim(profile.full_name) = ''
      or lower(trim(profile.full_name)) = lower(trim(profile.email))
    ) then
      update public.user_profiles
      set full_name = meta_name
      where id = auth.uid()
      returning * into profile;
    end if;
    return profile;
  end if;

  insert into public.user_profiles (id, email, full_name, role, location_id, org_id)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(meta_name, coalesce(auth.jwt() ->> 'email', '')),
    case
      when lower(coalesce(auth.jwt() ->> 'email', '')) = 'matthewdemoss@mosescars.com' then 'admin'::public.user_role
      when signup_mode = 'new_dealership' then 'admin'::public.user_role
      else 'rep'::public.user_role
    end,
    chosen,
    chosen_org
  )
  returning * into profile;

  return profile;
end;
$$;

drop function if exists public.lookup_stores_by_org_code(text);
create or replace function public.lookup_stores_by_org_code(input_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cleaned text;
  found_row organizations%rowtype;
  store_list jsonb;
begin
  cleaned := upper(trim(coalesce(input_code, '')));
  if cleaned = '' then
    return null;
  end if;
  select * into found_row from public.organizations where upper(join_code) = cleaned;
  if not found then
    return null;
  end if;
  select coalesce(
    jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.name),
    '[]'::jsonb
  )
  into store_list
  from public.locations l
  where l.active = true and l.org_id = found_row.id;
  return jsonb_build_object(
    'org_id', found_row.id,
    'org_name', found_row.name,
    'join_code', found_row.join_code,
    'stores', store_list
  );
end;
$$;

-- Existing signed-in users (no org / no rooftop) connect with the same join code.
drop function if exists public.join_organization_by_code(text, uuid);
create or replace function public.join_organization_by_code(
  input_code text,
  target_location_id uuid
)
returns table (org_id uuid, org_name text, location_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
  found_row organizations%rowtype;
  loc locations%rowtype;
  profile user_profiles%rowtype;
  next_role user_role;
  was_unlinked boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  cleaned := upper(trim(coalesce(input_code, '')));
  if cleaned = '' or cleaned !~ '^[A-Z0-9]{3,32}$' then
    raise exception 'Enter a dealership group code';
  end if;
  if target_location_id is null then
    raise exception 'Select your dealership store';
  end if;

  select * into found_row from public.organizations where upper(join_code) = cleaned;
  if not found then
    raise exception 'Invalid dealership code.';
  end if;

  select * into loc
  from public.locations
  where id = target_location_id and active = true;
  if not found or loc.org_id is distinct from found_row.id then
    raise exception 'Select a store in that dealership group';
  end if;

  select * into profile from public.user_profiles where id = auth.uid();
  was_unlinked := not found or profile.org_id is null;
  profile := public.ensure_own_profile(target_location_id);

  if profile.org_id is not null and profile.org_id is distinct from found_row.id then
    raise exception 'You are already linked to a dealership group.';
  end if;

  next_role := profile.role;
  if lower(coalesce(profile.email, '')) = 'matthewdemoss@mosescars.com' then
    next_role := 'admin';
  elsif was_unlinked then
    next_role := 'rep';
  end if;

  update public.user_profiles
  set
    org_id = found_row.id,
    location_id = loc.id,
    role = next_role
  where id = auth.uid()
  returning * into profile;

  org_id := found_row.id;
  org_name := found_row.name;
  location_id := loc.id;
  return next;
end;
$$;

-- Collision-free 6-character share codes (A–Z, 0–9).
drop function if exists public.generate_dealership_join_code();
create or replace function public.generate_dealership_join_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  candidate text;
  i int;
  attempt int := 0;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * 36)::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.organizations where upper(join_code) = candidate
    );
    attempt := attempt + 1;
    if attempt > 40 then
      raise exception 'Could not generate a unique dealership code';
    end if;
  end loop;
  return candidate;
end;
$$;

drop function if exists public.set_organization_code(uuid, text);
create or replace function public.set_organization_code(target_org_id uuid, new_code text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
  found_row organizations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_admin() then
    raise exception 'Only an admin can change the dealership group code';
  end if;
  cleaned := upper(trim(coalesce(new_code, '')));
  if cleaned = '' or cleaned !~ '^[A-Z0-9]{3,32}$' then
    raise exception 'Enter a dealership group code (letters and numbers)';
  end if;
  if exists (
    select 1 from public.organizations
    where upper(join_code) = cleaned and id is distinct from target_org_id
  ) then
    raise exception 'That dealership group code is already in use';
  end if;
  update public.organizations
  set join_code = cleaned
  where id = target_org_id
  returning * into found_row;
  if not found then
    raise exception 'Organization not found';
  end if;
  return found_row;
end;
$$;

drop function if exists public.register_new_dealership_admin(text, text, text);
drop function if exists public.register_new_dealership_admin(text, text);
create or replace function public.register_new_dealership_admin(
  org_name text,
  admin_full_name text
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_name text;
  cleaned_code text;
  cleaned_admin text;
  found_row organizations%rowtype;
  profile user_profiles%rowtype;
  has_profile boolean := false;
  default_tiers jsonb := '[
    {"min":0,"max":3,"rate":0.2},
    {"min":4,"max":7,"rate":0.25},
    {"min":8,"max":11,"rate":0.3},
    {"min":12,"max":null,"rate":0.35}
  ]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  cleaned_name := nullif(trim(coalesce(org_name, '')), '');
  cleaned_admin := nullif(trim(coalesce(admin_full_name, '')), '');

  if cleaned_name is null or char_length(cleaned_name) < 2 then
    raise exception 'Enter a dealership / group name';
  end if;
  if cleaned_admin is null or char_length(cleaned_admin) < 2 then
    raise exception 'Enter your full name';
  end if;

  select * into profile from public.user_profiles where id = auth.uid();
  has_profile := found;
  if has_profile and profile.org_id is not null then
    update public.user_profiles
    set
      role = 'admin',
      full_name = coalesce(nullif(trim(profile.full_name), ''), cleaned_admin)
    where id = auth.uid()
    returning * into profile;
    return profile;
  end if;

  if exists (
    select 1 from public.organizations
    where lower(trim(name)) = lower(cleaned_name)
  ) then
    raise exception 'This dealership name is already registered.';
  end if;

  cleaned_code := public.generate_dealership_join_code();

  begin
    insert into public.organizations (name, join_code, created_by, pay_tiers)
    values (cleaned_name, cleaned_code, auth.uid(), default_tiers)
    returning * into found_row;
  exception
    when unique_violation then
      if exists (
        select 1 from public.organizations
        where lower(trim(name)) = lower(cleaned_name)
      ) then
        raise exception 'This dealership name is already registered.';
      end if;
      cleaned_code := public.generate_dealership_join_code();
      insert into public.organizations (name, join_code, created_by, pay_tiers)
      values (cleaned_name, cleaned_code, auth.uid(), default_tiers)
      returning * into found_row;
  end;

  if has_profile then
    update public.user_profiles
    set
      role = 'admin',
      full_name = cleaned_admin,
      org_id = found_row.id,
      location_id = profile.location_id
    where id = auth.uid()
    returning * into profile;
  else
    insert into public.user_profiles (id, email, full_name, role, location_id, org_id)
    values (
      auth.uid(),
      coalesce(auth.jwt() ->> 'email', ''),
      cleaned_admin,
      'admin'::public.user_role,
      null,
      found_row.id
    )
    on conflict (id) do update
      set
        role = 'admin',
        full_name = excluded.full_name,
        org_id = excluded.org_id
    returning * into profile;
  end if;

  return profile;
end;
$$;

drop function if exists public.admin_update_pay_tiers(uuid, jsonb);
create or replace function public.admin_update_pay_tiers(
  target_org_id uuid,
  new_tiers jsonb
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row organizations%rowtype;
  item jsonb;
  min_units numeric;
  max_units numeric;
  pack_rate numeric;
  normalized jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_admin() then
    raise exception 'Only an admin can update the organization pay plan';
  end if;
  if target_org_id is null or target_org_id is distinct from public.current_org_id() then
    raise exception 'You can only update your organization pay plan';
  end if;
  if jsonb_typeof(coalesce(new_tiers, 'null'::jsonb)) is distinct from 'array' or jsonb_array_length(new_tiers) < 1 then
    raise exception 'Add at least one unit tier';
  end if;

  for item in select value from jsonb_array_elements(new_tiers)
  loop
    min_units := coalesce((item ->> 'min')::numeric, (item ->> 'min_units')::numeric);
    pack_rate := coalesce((item ->> 'rate')::numeric, (item ->> 'percent')::numeric, (item ->> 'pack')::numeric);
    if item ->> 'max' is null or trim(coalesce(item ->> 'max', '')) = '' then
      max_units := null;
    else
      max_units := (item ->> 'max')::numeric;
    end if;
    if min_units is null or pack_rate is null or min_units < 0 or pack_rate < 0 then
      raise exception 'Enter min units and a pack percentage for every tier';
    end if;
    if pack_rate > 1 then
      pack_rate := pack_rate / 100.0;
    end if;
    if max_units is not null and max_units < min_units then
      raise exception 'Max units must be greater than or equal to min units';
    end if;
    normalized := normalized || jsonb_build_array(
      jsonb_build_object(
        'min', min_units,
        'max', max_units,
        'rate', pack_rate
      )
    );
  end loop;

  update public.organizations
  set pay_tiers = normalized
  where id = target_org_id
  returning * into found_row;
  if not found then
    raise exception 'Organization not found';
  end if;
  return found_row;
end;
$$;

drop function if exists public.list_signup_locations();
create or replace function public.list_signup_locations()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.name
  from public.locations l
  where l.active = true
  order by l.name;
$$;

-- Org rooftops the signed-in user may switch into (admin-created locations only).
drop function if exists public.get_available_org_locations();
create or replace function public.get_available_org_locations()
returns table (id uuid, name text, org_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.name, l.org_id
  from public.locations l
  where l.active = true
    and public.current_org_id() is not null
    and l.org_id = public.current_org_id()
  order by l.name;
$$;

drop function if exists public.set_my_location(uuid);
create or replace function public.set_my_location(new_location_id uuid)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  profile user_profiles%rowtype;
  loc locations%rowtype;
  org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if new_location_id is null then
    raise exception 'Select a dealership store';
  end if;

  select * into loc from public.locations where id = new_location_id and active = true;
  if not found then
    raise exception 'That store is not available';
  end if;

  org := public.current_org_id();
  if org is not null and loc.org_id is distinct from org then
    raise exception 'That store is not available';
  end if;

  update public.user_profiles
  set
    location_id = new_location_id,
    org_id = coalesce(loc.org_id, org_id)
  where id = auth.uid()
  returning * into profile;
  if not found then
    raise exception 'Profile not found';
  end if;
  return profile;
end;
$$;

drop function if exists public.update_own_location_id(uuid);
create or replace function public.update_own_location_id(p_location_id uuid)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.set_my_location(p_location_id);
end;
$$;

drop function if exists public.update_own_email(text);
create or replace function public.update_own_email(new_email text)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  profile user_profiles%rowtype;
  cleaned text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  cleaned := nullif(lower(trim(new_email)), '');
  if cleaned is null or position('@' in cleaned) = 0 then
    raise exception 'Enter a valid email address';
  end if;
  update public.user_profiles
  set email = cleaned
  where id = auth.uid()
  returning * into profile;
  if not found then
    raise exception 'Profile not found';
  end if;
  return profile;
end;
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.current_location_id() to authenticated;
grant execute on function public.manager_covers_deal(uuid, uuid) to authenticated;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.get_current_dealership() to authenticated;
grant execute on function public.ensure_own_profile(uuid) to authenticated;
grant execute on function public.lookup_stores_by_org_code(text) to anon, authenticated;
grant execute on function public.join_organization_by_code(text, uuid) to authenticated;
grant execute on function public.generate_dealership_join_code() to authenticated;
grant execute on function public.set_organization_code(uuid, text) to authenticated;
grant execute on function public.register_new_dealership_admin(text, text) to authenticated;
grant execute on function public.admin_update_pay_tiers(uuid, jsonb) to authenticated;
grant execute on function public.list_signup_locations() to anon, authenticated;
grant execute on function public.get_available_org_locations() to authenticated;
grant execute on function public.set_my_location(uuid) to authenticated;
grant execute on function public.update_own_location_id(uuid) to authenticated;
grant execute on function public.update_own_email(text) to authenticated;

drop function if exists public.update_own_full_name(text);
create or replace function public.update_own_full_name(new_name text)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  profile user_profiles%rowtype;
  cleaned text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  cleaned := nullif(trim(new_name), '');
  if cleaned is null then
    raise exception 'Full name is required';
  end if;
  update public.user_profiles
  set full_name = cleaned
  where id = auth.uid()
  returning * into profile;
  if not found then
    raise exception 'Profile not found';
  end if;
  return profile;
end;
$$;

grant execute on function public.update_own_full_name(text) to authenticated;

update public.user_profiles
set role = 'admin'
where lower(email) = 'matthewdemoss@mosescars.com'
  and role is distinct from 'admin';

-- Join-code Gmail account is a sales rep, not an implicit first-store admin.
update public.user_profiles
set role = 'rep'
where lower(email) = 'matthewdemoss@gmail.com'
  and role = 'admin';

-- Admin assignment: role + rooftop in one write. Promoting to Manager requires a store.
drop function if exists public.admin_set_user_assignment(uuid, public.user_role, uuid);
create or replace function public.admin_set_user_assignment(
  target_user_id uuid,
  new_role public.user_role,
  target_location_id uuid
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role user_role;
  found_row user_profiles%rowtype;
  loc locations%rowtype;
  next_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select role into caller_role
  from public.user_profiles
  where id = auth.uid();

  if caller_role is distinct from 'admin' then
    raise exception 'Only an admin can update assignments.';
  end if;

  if target_user_id is null then
    raise exception 'User not found';
  end if;

  select * into found_row from public.user_profiles where id = target_user_id;
  if not found then
    raise exception 'User not found';
  end if;

  if coalesce(
    found_row.org_id,
    (select store.org_id from public.locations store where store.id = found_row.location_id)
  ) is distinct from public.current_org_id() then
    raise exception 'User not found';
  end if;

  if target_user_id = auth.uid() and new_role is distinct from found_row.role then
    raise exception 'You cannot change your own role.';
  end if;

  if lower(coalesce(found_row.email, '')) = 'matthewdemoss@mosescars.com' and new_role is distinct from 'admin' then
    raise exception 'That account is locked as Admin.';
  end if;

  if new_role = 'manager' and target_location_id is null then
    raise exception 'Select a location when assigning a Manager.';
  end if;

  next_org := found_row.org_id;
  if target_location_id is not null then
    select * into loc from public.locations where id = target_location_id and active = true;
    if not found then
      raise exception 'That store is not available';
    end if;
    if loc.org_id is distinct from public.current_org_id() then
      raise exception 'That store is not available';
    end if;
    next_org := coalesce(loc.org_id, found_row.org_id, public.current_org_id());
  end if;

  update public.user_profiles
  set
    role = new_role,
    location_id = target_location_id,
    org_id = next_org,
    custom_role_id = case
      when new_role in ('admin', 'manager') then null
      else found_row.custom_role_id
    end
  where id = target_user_id
  returning * into found_row;

  return found_row;
end;
$$;

grant execute on function public.admin_set_user_assignment(uuid, public.user_role, uuid) to authenticated;

drop function if exists public.admin_set_user_location(uuid, uuid);
create or replace function public.admin_set_user_location(
  target_user_id uuid,
  target_location_id uuid
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row user_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into found_row from public.user_profiles where id = target_user_id;
  if not found then
    raise exception 'User not found';
  end if;
  return public.admin_set_user_assignment(target_user_id, found_row.role, target_location_id);
end;
$$;

grant execute on function public.admin_set_user_location(uuid, uuid) to authenticated;

drop function if exists public.admin_set_user_role(uuid, public.user_role);
create or replace function public.admin_set_user_role(
  target_user_id uuid,
  new_role public.user_role
)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  loc uuid;
begin
  select location_id into loc from public.user_profiles where id = target_user_id;
  return public.admin_set_user_assignment(target_user_id, new_role, loc);
end;
$$;

grant execute on function public.admin_set_user_role(uuid, public.user_role) to authenticated;

-- Any admin can promote any user to admin. Promotion never demotes the caller.
drop function if exists public.update_user_role(uuid, public.user_role);
create or replace function public.update_user_role(
  target_user_id uuid,
  new_role public.user_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_set_user_role(target_user_id, new_role);
end;
$$;

grant execute on function public.update_user_role(uuid, public.user_role) to authenticated;

drop function if exists public.delete_user_by_admin(uuid);
create or replace function public.delete_user_by_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role user_role;
begin
  select role into caller_role
  from public.user_profiles
  where id = auth.uid();

  if caller_role is distinct from 'admin' then
    raise exception 'Only an admin can delete accounts.';
  end if;

  if target_user_id is null then
    raise exception 'User not found';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'You cannot delete your own account.';
  end if;

  if not exists (select 1 from public.user_profiles where id = target_user_id)
     and not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'User not found';
  end if;

  delete from public.deal_records
  where rep_id = target_user_id
     or created_by = target_user_id;

  delete from public.pay_tracker_state
  where id = target_user_id
     or user_id = target_user_id
     or employee_id = target_user_id
     or created_by = target_user_id;

  delete from public.admin_employee_sheets
  where employee_id = target_user_id
     or created_by = target_user_id;

  delete from public.user_profiles
  where id = target_user_id;

  delete from auth.users
  where id = target_user_id;
end;
$$;

grant execute on function public.delete_user_by_admin(uuid) to authenticated;

grant select on table public.locations to anon, authenticated;
grant select on table public.user_profiles to authenticated;
grant select, insert, update, delete on table public.deal_records to authenticated;
grant select on table public.organizations to authenticated;
grant select, insert, update on table public.pay_tracker_state to authenticated;
grant select, insert, update on table public.admin_employee_sheets to authenticated;
grant select, insert, update, delete on table public.custom_roles to authenticated;

-- Basic read policies
drop policy if exists "Read locations authenticated" on public.locations;
create policy "Read locations authenticated"
  on public.locations for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists "Read active locations for signup" on public.locations;
create policy "Read active locations for signup"
  on public.locations for select to anon
  using (active = true);

drop policy if exists "Admin read organizations" on public.organizations;
drop policy if exists "Read own organization" on public.organizations;
create policy "Read own organization"
  on public.organizations for select to authenticated
  using (id = public.current_org_id());

drop policy if exists "Admin write organizations" on public.organizations;
create policy "Admin write organizations"
  on public.organizations for all to authenticated
  using (public.is_admin() and id = public.current_org_id())
  with check (public.is_admin() and id = public.current_org_id());

drop policy if exists "Read custom roles" on public.custom_roles;
create policy "Read custom roles"
  on public.custom_roles for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists "Admin write custom roles" on public.custom_roles;
create policy "Admin write custom roles"
  on public.custom_roles for all to authenticated
  using (public.is_admin() and org_id = public.current_org_id())
  with check (public.is_admin() and org_id = public.current_org_id());

drop policy if exists "Read user profiles" on public.user_profiles;
create policy "Read user profiles"
  on public.user_profiles for select to authenticated
  using (
    id = auth.uid()
    or (
      public.is_admin()
      and coalesce(
        org_id,
        (select loc.org_id from public.locations loc where loc.id = user_profiles.location_id)
      ) = public.current_org_id()
    )
    or (
      public.is_manager()
      and public.current_location_id() is not null
      and location_id = public.current_location_id()
    )
  );

drop policy if exists "Read deal records" on public.deal_records;
create policy "Read deal records"
  on public.deal_records for select to authenticated
  using (
    rep_id = auth.uid()
    or (
      public.is_admin()
      and (
        exists (
          select 1
          from public.locations loc
          where loc.id = deal_records.location_id
            and loc.org_id = public.current_org_id()
        )
        or exists (
          select 1
          from public.user_profiles p
          where p.id = deal_records.rep_id
            and p.org_id = public.current_org_id()
        )
      )
    )
    or (
      public.manager_covers_deal(location_id, rep_id)
    )
  );

-- Write policies
drop policy if exists "Admin write locations" on public.locations;
create policy "Admin write locations"
  on public.locations for all to authenticated
  using (public.is_admin() and (org_id = public.current_org_id() or org_id is null))
  with check (public.is_admin() and (org_id = public.current_org_id() or org_id is null));

drop policy if exists "Insert own profile" on public.user_profiles;
create policy "Insert own profile"
  on public.user_profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "Admin delete profiles" on public.user_profiles;
create policy "Admin delete profiles"
  on public.user_profiles for delete to authenticated
  using (public.is_admin() and id is distinct from auth.uid());

drop policy if exists "Admin update profiles" on public.user_profiles;
create policy "Admin update profiles"
  on public.user_profiles for update to authenticated
  using (
    public.is_admin()
    and coalesce(
      org_id,
      (select loc.org_id from public.locations loc where loc.id = user_profiles.location_id)
    ) = public.current_org_id()
  )
  with check (
    public.is_admin()
    and coalesce(
      org_id,
      (select loc.org_id from public.locations loc where loc.id = user_profiles.location_id)
    ) = public.current_org_id()
  );

drop policy if exists "Write own or managed deals" on public.deal_records;
create policy "Write own or managed deals"
  on public.deal_records for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.is_admin()
      or rep_id = auth.uid()
      or (
        public.is_manager()
        and public.current_location_id() is not null
        and location_id = public.current_location_id()
      )
    )
  );

drop policy if exists "Update own or managed deals" on public.deal_records;
create policy "Update own or managed deals"
  on public.deal_records for update to authenticated
  using (
    public.is_admin()
    or rep_id = auth.uid()
    or (
      public.manager_covers_deal(location_id, rep_id)
    )
  )
  with check (
    public.is_admin()
    or rep_id = auth.uid()
    or (
      public.manager_covers_deal(location_id, rep_id)
    )
  );

drop policy if exists "Delete own or admin deals" on public.deal_records;
create policy "Delete own or admin deals"
  on public.deal_records for delete to authenticated
  using (
    public.is_admin()
    or rep_id = auth.uid()
    or public.manager_covers_deal(location_id, rep_id)
  );

-- Manager/admin drafts never overwrite live_data. Rep confirmation submits to
-- the manager queue without writing live_data. Only admin final approval
-- (status active/approved) may merge staged_data into live_data.
drop trigger if exists deal_records_guard on public.deal_records;
drop function if exists public.guard_deal_record_write();
create or replace function public.guard_deal_record_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if public.is_admin() or public.is_manager() then
    if tg_op = 'INSERT' and new.status::text in ('draft', 'staged', 'pending_rep_review', 'awaiting_review', 'pushed') then
      new.live_data := '{}'::jsonb;
    end if;
    if tg_op = 'UPDATE' and new.status::text not in ('approved', 'active') then
      new.live_data := coalesce(old.live_data, '{}'::jsonb);
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.rep_id is distinct from auth.uid() then
      raise exception 'Reps can only insert their own deals';
    end if;
    if new.status::text in ('draft', 'staged', 'pending_rep_review', 'awaiting_review', 'pushed', 'pending_manager_approval') then
      new.live_data := '{}'::jsonb;
    end if;
    return new;
  end if;
  -- Sales reps may Accept & Lock a manager push onto their own live sheet.
  if tg_op = 'UPDATE'
     and old.rep_id = auth.uid()
     and new.status::text in ('approved', 'active')
     and old.status::text in (
       'draft',
       'staged',
       'pending_rep_review',
       'awaiting_review',
       'pushed',
       'pending_manager_approval'
     )
  then
    return new;
  end if;
  if old.status::text in ('staged', 'pending_rep_review', 'awaiting_review', 'pushed', 'pending_manager_approval', 'pending_admin_approval', 'rejected', 'draft') then
    new.live_data := coalesce(old.live_data, '{}'::jsonb);
    if new.status::text not in ('staged', 'pending_rep_review', 'awaiting_review', 'pushed', 'pending_manager_approval', 'rejected', 'draft') then
      raise exception 'Reps cannot approve deals that still need a manager';
    end if;
    return new;
  end if;
  if old.status::text in ('approved', 'active') and new.status::text in ('approved', 'active') then
    return new;
  end if;
  raise exception 'Only a manager or admin can approve deals';
end;
$$;

drop trigger if exists deal_records_guard on public.deal_records;
create trigger deal_records_guard
  before insert or update on public.deal_records
  for each row execute procedure public.guard_deal_record_write();

-- Resolve a sales-rep profile by user_profiles.id or pay_tracker_state employee_id/user_id/id.
drop function if exists public.resolve_user_profile(uuid);
create or replace function public.resolve_user_profile(target uuid)
returns public.user_profiles
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found_row user_profiles%rowtype;
begin
  if target is null then
    return found_row;
  end if;
  select * into found_row from public.user_profiles where id = target;
  if found then
    return found_row;
  end if;
  select p.* into found_row
  from public.pay_tracker_state sheet
  join public.user_profiles p
    on p.id = coalesce(sheet.employee_id, sheet.user_id, sheet.id)
  where sheet.id = target
     or sheet.employee_id = target
     or sheet.user_id = target
  limit 1;
  return found_row;
end;
$$;

grant execute on function public.resolve_user_profile(uuid) to authenticated;

drop function if exists public.same_location_as(uuid);
create or replace function public.same_location_as(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles actor,
         public.resolve_user_profile(target) other
    where actor.id = auth.uid()
      and other.id is not null
      and actor.location_id is not null
      and actor.location_id = other.location_id
  );
$$;

grant execute on function public.same_location_as(uuid) to authenticated;

-- Pay-period identity used to collapse stacked submissions for the same rep.
drop function if exists public.deal_period_key(jsonb, jsonb, jsonb);
create or replace function public.deal_period_key(staged jsonb, proposed jsonb, live jsonb)
returns text
language plpgsql
immutable
as $$
declare
  payload jsonb;
  month_key text;
  sheet_key text;
begin
  payload := case
    when staged is not null and staged <> '{}'::jsonb then staged
    when proposed is not null and proposed <> '{}'::jsonb then proposed
    else coalesce(live, '{}'::jsonb)
  end;
  month_key := nullif(payload->>'monthId', '');
  if month_key is null then
    month_key := concat(coalesce(payload->>'year', ''), '-', coalesce(payload->>'month', ''));
  end if;
  sheet_key := nullif(payload->>'sheetId', '');
  if sheet_key is null then
    if payload->>'kind' = 'sheet' then
      sheet_key := coalesce(nullif(payload->>'entityId', ''), 'sheet');
    else
      sheet_key := 'sheet';
    end if;
  end if;
  return month_key || '::' || sheet_key;
end;
$$;

grant execute on function public.deal_period_key(jsonb, jsonb, jsonb) to authenticated;

drop function if exists public.deal_commit_payload(jsonb, jsonb, jsonb);
create or replace function public.deal_commit_payload(staged jsonb, proposed jsonb, live jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when proposed is not null and proposed <> '{}'::jsonb then proposed
    when staged is not null and staged <> '{}'::jsonb then staged
    else coalesce(live, '{}'::jsonb)
  end;
$$;

grant execute on function public.deal_commit_payload(jsonb, jsonb, jsonb) to authenticated;

drop function if exists public.push_drafts_to_employee(uuid);
drop function if exists public.push_drafts_to_employee(uuid, jsonb);

create or replace function public.push_drafts_to_employee(
  target_rep uuid,
  payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
  next_status record_status;
  pushed_ids uuid[] := '{}';
  period_keys text[] := '{}';
  rec_payload jsonb;
  sheet jsonb;
  kind text;
  entity_id text;
  existing_id uuid;
  loc uuid;
  actor uuid;
  hours numeric;
  rate numeric;
  pay numeric;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (public.is_admin() or (public.is_manager() and public.same_location_as(target_rep))) then
    raise exception 'Only the admin or a location manager can push deals';
  end if;

  actor := auth.uid();
  select location_id into loc from public.user_profiles where id = target_rep;

  -- Stamp proposed_data as a comparison buffer only.
  -- Never insert rows, never touch live_data, never promote or archive working deals.
  if payload is not null and payload <> '{}'::jsonb then
    if jsonb_typeof(payload->'records') = 'array' then
      for rec_payload in select value from jsonb_array_elements(payload->'records')
      loop
        kind := rec_payload->>'kind';
        entity_id := rec_payload->>'entityId';
        if kind is null or entity_id is null or kind = '' or entity_id = '' then
          continue;
        end if;
        update public.deal_records
        set
          proposed_data = rec_payload,
          updated_at = now()
        where rep_id = target_rep
          and (
            (live_data->>'kind' = kind and live_data->>'entityId' = entity_id)
            or (staged_data->>'kind' = kind and staged_data->>'entityId' = entity_id)
            or (proposed_data->>'kind' = kind and proposed_data->>'entityId' = entity_id)
          );
      end loop;
    end if;
  end if;

  -- Always persist the manager worksheet snapshot, even when no draft rows existed.
  if payload is not null and payload <> '{}'::jsonb then
    insert into public.pay_tracker_state (
      id, user_id, employee_id, month_id, status, state, admin_pushed_snapshot, location_id, created_by, updated_at
    ) values (
      target_rep,
      target_rep,
      target_rep,
      coalesce(nullif(payload->>'month_id', ''), nullif(payload->>'monthId', '')),
      'admin_pushed',
      payload,
      payload,
      loc,
      actor,
      now()
    )
    on conflict (id) do update
      set
        user_id = excluded.user_id,
        employee_id = excluded.employee_id,
        month_id = excluded.month_id,
      status = 'admin_pushed',
      state = public.pay_tracker_state.state,
      admin_pushed_snapshot = payload,
        rep_draft = null,
        approval_diffs = '[]'::jsonb,
        pay_delta = 0,
        finalized_label = null,
        deny_reason = null,
        location_id = coalesce(excluded.location_id, public.pay_tracker_state.location_id),
        created_by = excluded.created_by,
        updated_at = now();
    if updated = 0 then
      updated := 1;
    end if;
  end if;

  -- Staging snapshot is copied above. Mark the admin master pushed without rewriting sheet_data.
  update public.admin_employee_sheets
  set
    status = 'pushed',
    updated_at = now()
  where employee_id = target_rep
    and status is distinct from 'paid';

  return updated;
end;
$$;

drop function if exists public.recall_pending_push(uuid);
create or replace function public.recall_pending_push(target_rep uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (public.is_admin() or (public.is_manager() and public.same_location_as(target_rep))) then
    raise exception 'Only the admin or a location manager can recall a push';
  end if;

  update public.deal_records
  set
    status = 'draft',
    proposed_data = null,
    reject_reason = null,
    updated_at = now()
  where rep_id = target_rep
    and status::text in (
      'pending_rep_review',
      'awaiting_review',
      'pushed',
      'staged',
      'admin_pushed',
      'rep_accepted_no_changes',
      'rep_authorized_no_changes',
      'rep_modified',
      'rejected_by_manager',
      'manager_approved',
      'admin_final_approved',
      'pending_manager_approval',
      'pending_admin_approval'
    );
  get diagnostics updated = row_count;

  update public.pay_tracker_state
  set
    status = 'draft',
    admin_pushed_snapshot = null,
    rep_draft = null,
    approval_diffs = '[]'::jsonb,
    pay_delta = 0,
    finalized_label = null,
    deny_reason = null,
    updated_at = now()
  where id = target_rep
     or employee_id = target_rep
     or user_id = target_rep;

  update public.admin_employee_sheets
  set
    status = 'draft',
    updated_at = now()
  where employee_id = target_rep
    and status is distinct from 'paid';

  update public.user_notifications
  set is_read = true
  where user_id = target_rep
    and is_read = false
    and kind in ('pay_push', 'pay_sheet');

  update public.user_profiles
  set roster_ready = false
  where id = target_rep;

  return updated;
end;
$$;

-- Confirming a rep review submits chosen values to the manager queue.
-- live_data stays frozen. previous_data stores the manager's original push
-- (empty for brand-new deals the rep accepted). Status is always
-- pending_manager_approval -- never pending_rep_review / pending_employee_review.
drop function if exists public.rep_submit_to_manager(uuid, jsonb);
create or replace function public.rep_submit_to_manager(
  target_rep uuid,
  updated_deals jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  decisions jsonb;
  item jsonb;
  found_row deal_records%rowtype;
  action text;
  live_id uuid;
  resolved jsonb;
  prior jsonb;
  applied integer := 0;
  leftover integer := 0;
  empty_json jsonb := '{}'::jsonb;
  keep_ids uuid[] := '{}';
  period_keys text[] := '{}';
  keep_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if target_rep is null then
    raise exception 'Sales rep not found';
  end if;
  if auth.uid() is distinct from target_rep then
    raise exception 'You can only submit your own deals';
  end if;

  if jsonb_typeof(coalesce(updated_deals, 'null'::jsonb)) = 'array' then
    decisions := updated_deals;
  elsif jsonb_typeof(updated_deals -> 'decisions') = 'array' then
    decisions := updated_deals -> 'decisions';
  elsif jsonb_typeof(updated_deals -> 'deals') = 'array' then
    decisions := updated_deals -> 'deals';
  else
    decisions := '[]'::jsonb;
  end if;

  for item in select value from jsonb_array_elements(coalesce(decisions, '[]'::jsonb))
  loop
    action := coalesce(nullif(item ->> 'action', ''), 'accept');
    select * into found_row
    from public.deal_records
    where id = (item ->> 'id')::uuid
      and rep_id = target_rep
      and status::text in ('pending_rep_review', 'awaiting_review', 'pushed', 'staged');
    if not found then
      continue;
    end if;

    live_id := nullif(item ->> 'live_id', '')::uuid;
    resolved := item -> 'live_data';
    if resolved is null or resolved = 'null'::jsonb then
      resolved := found_row.staged_data;
    end if;

    if action = 'decline' then
      if live_id is not null and live_id is distinct from found_row.id then
        update public.deal_records
        set
          staged_data = empty_json,
          proposed_data = empty_json,
          previous_data = empty_json,
          status = 'active',
          reject_reason = null,
          updated_at = now()
        where id = live_id
          and rep_id = target_rep;
      end if;
      if found_row.live_data is null or found_row.live_data = empty_json then
        delete from public.deal_records where id = found_row.id and rep_id = target_rep;
      else
        update public.deal_records
        set
          staged_data = empty_json,
          proposed_data = empty_json,
          previous_data = empty_json,
          status = 'active',
          reject_reason = null,
          updated_at = now()
        where id = found_row.id;
      end if;
      applied := applied + 1;
      continue;
    end if;

    if action not in ('accept', 'keep_mine', 'use_manager') then
      continue;
    end if;

    if action = 'accept' then
      prior := empty_json;
    else
      prior := coalesce(item -> 'previous_data', found_row.staged_data, empty_json);
    end if;

    if live_id is not null and live_id is distinct from found_row.id then
      update public.deal_records
      set
        staged_data = coalesce(resolved, found_row.staged_data),
        proposed_data = prior,
        previous_data = prior,
        status = 'pending_manager_approval',
        reject_reason = null,
        updated_at = now()
      where id = live_id
        and rep_id = target_rep;
      if found_row.live_data is null or found_row.live_data = empty_json then
        delete from public.deal_records where id = found_row.id and rep_id = target_rep;
      else
        update public.deal_records
        set
          staged_data = empty_json,
          proposed_data = empty_json,
          previous_data = empty_json,
          status = 'active',
          reject_reason = null,
          updated_at = now()
        where id = found_row.id;
      end if;
    else
      update public.deal_records
      set
        staged_data = coalesce(resolved, found_row.staged_data),
        proposed_data = prior,
        previous_data = prior,
        status = 'pending_manager_approval',
        reject_reason = null,
        updated_at = now()
      where id = found_row.id;
    end if;
    keep_id := coalesce(live_id, found_row.id);
    keep_ids := array_append(keep_ids, keep_id);
    period_keys := array_append(
      period_keys,
      public.deal_period_key(coalesce(resolved, found_row.staged_data), prior, found_row.live_data)
    );
    applied := applied + 1;
  end loop;

  -- Leftover employee-review rows are archived, not promoted. Promoting them
  -- re-stacked older pushes in the manager queue.
  update public.deal_records
  set
    status = 'rejected',
    reject_reason = 'Superseded by a newer submission',
    staged_data = empty_json,
    proposed_data = empty_json,
    previous_data = empty_json,
    updated_at = now()
  where rep_id = target_rep
    and status::text in ('pending_rep_review', 'awaiting_review', 'pushed', 'staged');
  get diagnostics leftover = row_count;

  if cardinality(keep_ids) > 0 then
    update public.deal_records
    set
      status = 'rejected',
      reject_reason = 'Superseded by a newer submission',
      staged_data = empty_json,
      proposed_data = empty_json,
      previous_data = empty_json,
      updated_at = now()
    where rep_id = target_rep
      and not (id = any (keep_ids))
      and status::text in ('pending_manager_approval', 'pending_admin_approval')
      and public.deal_period_key(staged_data, proposed_data, live_data) = any (period_keys);
  end if;

  update public.user_profiles
  set roster_ready = true
  where id = target_rep;

  return applied + leftover;
end;
$$;

drop function if exists public.submit_rep_review_to_manager(jsonb);
create or replace function public.submit_rep_review_to_manager(decisions jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.rep_submit_to_manager(
    auth.uid(),
    jsonb_build_object('decisions', coalesce(decisions, '[]'::jsonb))
  );
end;
$$;

-- Keep the previous name as an alias so a re-run updates both entry points.
drop function if exists public.resolve_pending_rep_review(jsonb);
create or replace function public.resolve_pending_rep_review(decisions jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.rep_submit_to_manager(
    auth.uid(),
    jsonb_build_object('decisions', coalesce(decisions, '[]'::jsonb))
  );
end;
$$;

drop function if exists public.accept_staged_as_is();
create or replace function public.accept_staged_as_is()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  update public.deal_records
  set
    live_data = case
      when staged_data is not null and staged_data <> '{}'::jsonb then staged_data
      else live_data
    end,
    status = 'approved',
    reject_reason = null,
    updated_at = now()
  where rep_id = auth.uid()
    and status = 'staged';

  get diagnostics updated = row_count;
  return updated;
end;
$$;

drop function if exists public.submit_modified_staged();
create or replace function public.submit_modified_staged()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  update public.deal_records
  set
    status = 'pending_manager_approval',
    updated_at = now()
  where rep_id = auth.uid()
    and status = 'staged';

  get diagnostics updated = row_count;
  return updated;
end;
$$;

drop function if exists public.approve_deal_record(uuid);
create or replace function public.approve_deal_record(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row deal_records%rowtype;
begin
  select * into found_row from public.deal_records where id = target_id;
  if not found then
    raise exception 'Deal not found';
  end if;
  if not (
    public.is_admin()
    or public.manager_covers_deal(found_row.location_id, found_row.rep_id)
  ) then
    raise exception 'Not allowed to approve this deal';
  end if;
  update public.deal_records
  set
    live_data = case
      when staged_data is not null and staged_data <> '{}'::jsonb then staged_data
      else live_data
    end,
    status = 'approved',
    reject_reason = null,
    updated_at = now()
  where id = target_id;
end;
$$;

drop function if exists public.reject_deal_record(uuid, text);
create or replace function public.reject_deal_record(target_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row deal_records%rowtype;
begin
  select * into found_row from public.deal_records where id = target_id;
  if not found then
    raise exception 'Deal not found';
  end if;
  if not (
    public.is_admin()
    or public.manager_covers_deal(found_row.location_id, found_row.rep_id)
  ) then
    raise exception 'Not allowed to reject this deal';
  end if;
  update public.deal_records
  set
    status = 'rejected',
    reject_reason = nullif(trim(reason), ''),
    updated_at = now()
  where id = target_id;
end;
$$;

drop function if exists public.forward_deals_to_admin(uuid[]);
create or replace function public.forward_deals_to_admin(target_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row deal_records%rowtype;
  target uuid;
  updated integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  foreach target in array coalesce(target_ids, '{}'::uuid[])
  loop
    select * into found_row from public.deal_records where id = target;
    if not found then
      continue;
    end if;
    if found_row.status::text not in ('pending_manager_approval', 'pending_admin_approval') then
      continue;
    end if;
    if not (
      public.is_admin()
      or public.manager_covers_deal(found_row.location_id, found_row.rep_id)
    ) then
      raise exception 'Not allowed to forward this deal';
    end if;
    update public.deal_records
    set
      live_data = public.deal_commit_payload(staged_data, proposed_data, live_data),
      staged_data = '{}'::jsonb,
      proposed_data = null,
      previous_data = '{}'::jsonb,
      status = 'active',
      reject_reason = null,
      updated_at = now()
    where id = target;
    updated := updated + 1;
  end loop;

  return updated;
end;
$$;

drop function if exists public.final_approve_deals(uuid[]);
create or replace function public.final_approve_deals(target_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row deal_records%rowtype;
  target uuid;
  updated integer := 0;
  empty_json jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (
    public.is_admin()
    or public.is_manager()
  ) then
    raise exception 'Only a manager or admin can lock deals into live records';
  end if;

  foreach target in array coalesce(target_ids, '{}'::uuid[])
  loop
    select * into found_row from public.deal_records where id = target;
    if not found then
      continue;
    end if;
    if found_row.status::text not in ('pending_admin_approval', 'pending_manager_approval') then
      continue;
    end if;
    if public.is_manager() and not public.manager_covers_deal(found_row.location_id, found_row.rep_id) then
      raise exception 'Not allowed to lock this deal';
    end if;
    update public.deal_records
    set
      live_data = public.deal_commit_payload(staged_data, proposed_data, live_data),
      staged_data = empty_json,
      proposed_data = null,
      previous_data = empty_json,
      status = 'active',
      reject_reason = null,
      updated_at = now()
    where id = target;
    updated := updated + 1;
  end loop;

  return updated;
end;
$$;

drop function if exists public.return_deals_to_manager(uuid[]);
create or replace function public.return_deals_to_manager(target_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row deal_records%rowtype;
  target uuid;
  updated integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_admin() then
    raise exception 'Only an admin can return deals to a manager';
  end if;

  foreach target in array coalesce(target_ids, '{}'::uuid[])
  loop
    select * into found_row from public.deal_records where id = target;
    if not found then
      continue;
    end if;
    if found_row.status::text is distinct from 'pending_admin_approval' then
      continue;
    end if;
    update public.deal_records
    set
      status = 'pending_manager_approval',
      updated_at = now()
    where id = target;
    updated := updated + 1;
  end loop;

  return updated;
end;
$$;

drop function if exists public.commit_proposed_to_live(uuid[]);
create or replace function public.commit_proposed_to_live(target_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row deal_records%rowtype;
  target uuid;
  updated integer := 0;
  empty_json jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  foreach target in array coalesce(target_ids, '{}'::uuid[])
  loop
    select * into found_row from public.deal_records where id = target;
    if not found then
      continue;
    end if;
    if found_row.status::text not in (
      'draft',
      'staged',
      'pending_rep_review',
      'awaiting_review',
      'pushed',
      'pending_manager_approval',
      'pending_admin_approval'
    ) then
      continue;
    end if;
    if found_row.rep_id is distinct from auth.uid()
       and not (
         public.is_admin()
         or public.manager_covers_deal(found_row.location_id, found_row.rep_id)
       )
    then
      raise exception 'Not allowed to lock this deal';
    end if;
    update public.deal_records
    set
      live_data = public.deal_commit_payload(staged_data, proposed_data, live_data),
      staged_data = empty_json,
      proposed_data = null,
      previous_data = empty_json,
      status = 'active',
      reject_reason = null,
      updated_at = now()
    where id = target;
    updated := updated + 1;
  end loop;

  return updated;
end;
$$;

grant execute on function public.push_drafts_to_employee(uuid, jsonb) to authenticated;
grant execute on function public.recall_pending_push(uuid) to authenticated;
grant execute on function public.rep_submit_to_manager(uuid, jsonb) to authenticated;
grant execute on function public.submit_rep_review_to_manager(jsonb) to authenticated;
grant execute on function public.resolve_pending_rep_review(jsonb) to authenticated;
grant execute on function public.accept_staged_as_is() to authenticated;
grant execute on function public.submit_modified_staged() to authenticated;
grant execute on function public.approve_deal_record(uuid) to authenticated;
grant execute on function public.reject_deal_record(uuid, text) to authenticated;
grant execute on function public.forward_deals_to_admin(uuid[]) to authenticated;
grant execute on function public.final_approve_deals(uuid[]) to authenticated;
grant execute on function public.return_deals_to_manager(uuid[]) to authenticated;
grant execute on function public.commit_proposed_to_live(uuid[]) to authenticated;

-- Manager skip/authorize: mark the rep ready and move in-flight rows to
-- pending_manager_approval without waiting on employee confirmation.
drop function if exists public.manager_override_rep_ready(uuid);
create or replace function public.manager_override_rep_ready(target_rep uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row user_profiles%rowtype;
  empty_json jsonb := '{}'::jsonb;
  keep_ids uuid[] := '{}';
  period_keys text[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if target_rep is null then
    raise exception 'Sales rep not found';
  end if;

  select * into found_row from public.user_profiles where id = target_rep;
  if not found then
    found_row := public.resolve_user_profile(target_rep);
  end if;
  if found_row.id is null then
    raise exception 'Sales rep not found';
  end if;
  if found_row.role = 'admin' then
    raise exception 'Sales rep not found';
  end if;
  if not (
    public.is_admin()
    or public.manager_covers_deal(found_row.location_id, found_row.id)
  ) then
    raise exception 'Not allowed to authorize this sales rep';
  end if;

  with promoted as (
    update public.deal_records
    set
      staged_data = case
        when staged_data is not null and staged_data <> empty_json then staged_data
        else coalesce(live_data, empty_json)
      end,
      previous_data = case
        when previous_data is not null and previous_data <> empty_json then previous_data
        when staged_data is not null and staged_data <> empty_json then staged_data
        else coalesce(live_data, empty_json)
      end,
      proposed_data = case
        when proposed_data is not null and proposed_data <> empty_json then proposed_data
        when staged_data is not null and staged_data <> empty_json then staged_data
        else coalesce(live_data, empty_json)
      end,
      status = 'pending_manager_approval',
      reject_reason = null,
      updated_at = now()
    where rep_id in (found_row.id, target_rep)
      and status::text in ('draft', 'staged', 'pending_rep_review', 'awaiting_review', 'pushed', 'rejected')
    returning id, public.deal_period_key(staged_data, proposed_data, live_data) as period
  )
  select
    coalesce(array_agg(id), '{}'::uuid[]),
    coalesce(array_agg(distinct period), '{}'::text[])
  into keep_ids, period_keys
  from promoted;

  if cardinality(keep_ids) > 0 then
    update public.deal_records
    set
      status = 'rejected',
      reject_reason = 'Superseded by a newer submission',
      staged_data = empty_json,
      proposed_data = empty_json,
      previous_data = empty_json,
      updated_at = now()
    where rep_id in (found_row.id, target_rep)
      and not (id = any (keep_ids))
      and status::text in ('pending_manager_approval', 'pending_admin_approval')
      and public.deal_period_key(staged_data, proposed_data, live_data) = any (period_keys);
  end if;

  update public.user_profiles
  set roster_ready = true
  where id = found_row.id;
end;
$$;

drop function if exists public.manager_push_all_to_admin(uuid);
create or replace function public.manager_push_all_to_admin(target_location uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer := 0;
  not_ready integer := 0;
  empty_json jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if target_location is null then
    raise exception 'Select a store';
  end if;
  if not public.is_admin() then
    if not (
      public.is_manager()
      and public.current_location_id() is not null
      and public.current_location_id() = target_location
    ) then
      raise exception 'Not allowed to push this store to Admin';
    end if;
  end if;
  if not exists (select 1 from public.locations where id = target_location) then
    raise exception 'Store not found';
  end if;

  select count(*) into not_ready
  from public.user_profiles p
  where p.role = 'rep'
    and p.location_id = target_location
    and coalesce(p.roster_ready, false) = false
    and not exists (
      select 1
      from public.deal_records d
      where d.rep_id = p.id
        and d.status::text in ('pending_manager_approval', 'pending_admin_approval')
    );
  if not_ready > 0 then
    raise exception 'Every sales rep at this store must be ready before pushing to Admin';
  end if;

  update public.deal_records
  set
    live_data = public.deal_commit_payload(staged_data, proposed_data, live_data),
    staged_data = empty_json,
    proposed_data = null,
    previous_data = empty_json,
    status = 'active',
    reject_reason = null,
    updated_at = now()
  where location_id = target_location
    and status::text in ('pending_manager_approval', 'pending_admin_approval');

  get diagnostics updated = row_count;

  update public.user_profiles
  set roster_ready = false
  where role = 'rep'
    and location_id = target_location;

  return updated;
end;
$$;

grant execute on function public.manager_override_rep_ready(uuid) to authenticated;
grant execute on function public.manager_push_all_to_admin(uuid) to authenticated;

-- Employee alerts when admin/manager publish a pay plan or lock a sheet.
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  title text not null,
  message text not null,
  kind text not null default 'pay_push',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Existing projects may have created this table before location_id / kind existed.
-- CREATE TABLE IF NOT EXISTS will not add those columns.
alter table public.user_notifications
  add column if not exists user_id uuid references public.user_profiles(id) on delete cascade;
alter table public.user_notifications
  add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.user_notifications
  add column if not exists title text;
alter table public.user_notifications
  add column if not exists message text;
alter table public.user_notifications
  add column if not exists kind text not null default 'pay_push';
alter table public.user_notifications
  add column if not exists is_read boolean not null default false;
alter table public.user_notifications
  add column if not exists created_at timestamptz not null default now();

create index if not exists user_notifications_user_unread_idx
  on public.user_notifications (user_id, is_read, created_at desc);

alter table public.user_notifications enable row level security;

grant select, update, insert on table public.user_notifications to authenticated;

drop policy if exists "Read own notifications" on public.user_notifications;
create policy "Read own notifications"
  on public.user_notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Update own notifications" on public.user_notifications;
create policy "Update own notifications"
  on public.user_notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Insert location manager notifications" on public.user_notifications;
create policy "Insert location manager notifications"
  on public.user_notifications for insert to authenticated
  with check (
    exists (
      select 1
      from public.user_profiles m
      where m.id = user_notifications.user_id
        and m.role = 'manager'
        and (
          public.current_location_id() is null
          or m.location_id = public.current_location_id()
          or user_notifications.location_id = public.current_location_id()
        )
    )
  );

drop function if exists public.notify_reps_on_pay_push(uuid, text, text);
create or replace function public.notify_reps_on_pay_push(
  p_location_id uuid,
  p_title text,
  p_message text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
  title_text text;
  body_text text;
  org uuid;
  loc uuid;
  notice_kind text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or admin can notify the store';
  end if;

  title_text := nullif(trim(coalesce(p_title, '')), '');
  body_text := nullif(trim(coalesce(p_message, '')), '');
  if title_text is null or body_text is null then
    raise exception 'Notification title and message are required';
  end if;

  org := public.current_org_id();
  if org is null then
    raise exception 'Join a dealership first';
  end if;

  loc := p_location_id;
  if public.is_manager() and not public.is_admin() then
    if public.current_location_id() is null then
      raise exception 'Select a store';
    end if;
    if loc is not null and loc is distinct from public.current_location_id() then
      raise exception 'You can only notify your store';
    end if;
    loc := public.current_location_id();
  end if;

  if loc is not null and not exists (
    select 1 from public.locations
    where id = loc
      and (org_id = org or org_id is null)
  ) then
    raise exception 'Store not found';
  end if;

  notice_kind := case
    when title_text ilike '%pay plan%' then 'pay_plan'
    else 'pay_sheet'
  end;

  insert into public.user_notifications (user_id, location_id, title, message, kind)
  select
    p.id,
    coalesce(loc, p.location_id),
    title_text,
    body_text,
    notice_kind
  from public.user_profiles p
  where p.role = 'rep'
    and p.id is distinct from auth.uid()
    and coalesce(p.org_id, (
      select store.org_id from public.locations store where store.id = p.location_id
    )) = org
    and (loc is null or p.location_id = loc);

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

drop function if exists public.notify_rep_on_sheet_push(uuid, uuid, text, text);
create or replace function public.notify_rep_on_sheet_push(
  p_user_id uuid,
  p_location_id uuid,
  p_title text,
  p_message text
)
returns public.user_notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row user_notifications%rowtype;
  title_text text;
  body_text text;
  org uuid;
  loc uuid;
  target user_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or admin can notify a sales rep';
  end if;
  if p_user_id is null then
    raise exception 'Sales rep not found';
  end if;

  title_text := nullif(trim(coalesce(p_title, '')), '');
  body_text := nullif(trim(coalesce(p_message, '')), '');
  if title_text is null then
    title_text := 'Pay Sheet Updated';
  end if;
  if body_text is null then
    body_text := 'Manager has pushed an updated pay sheet for your review.';
  end if;

  org := public.current_org_id();
  if org is null then
    raise exception 'Join a dealership first';
  end if;

  select * into target from public.user_profiles where id = p_user_id;
  if not found then
    target := public.resolve_user_profile(p_user_id);
  end if;
  if target.id is null then
    raise exception 'Sales rep not found';
  end if;
  if target.role = 'admin' then
    raise exception 'Sales rep not found';
  end if;
  if coalesce(target.org_id, (
    select store.org_id from public.locations store where store.id = target.location_id
  )) is distinct from org
     and target.org_id is not null then
    raise exception 'Sales rep not found';
  end if;

  loc := coalesce(p_location_id, target.location_id);
  if public.is_manager() and not public.is_admin() then
    if public.current_location_id() is null then
      raise exception 'Select a store';
    end if;
    if loc is not null and loc is distinct from public.current_location_id() then
      raise exception 'You can only notify your store';
    end if;
    if target.location_id is distinct from public.current_location_id() then
      raise exception 'You can only notify your store';
    end if;
    loc := public.current_location_id();
  end if;

  if loc is not null and not exists (
    select 1 from public.locations
    where id = loc
      and (org_id = org or org_id is null)
  ) then
    raise exception 'Store not found';
  end if;

  insert into public.user_notifications (user_id, location_id, title, message, kind)
  values (target.id, loc, title_text, body_text, 'pay_sheet')
  returning * into found_row;
  return found_row;
end;
$$;

drop function if exists public.notify_location_managers(uuid, text, text);
create or replace function public.notify_location_managers(
  p_location_id uuid,
  p_title text,
  p_message text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
  title_text text;
  body_text text;
  org uuid;
  loc uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  title_text := nullif(trim(coalesce(p_title, '')), '');
  body_text := nullif(trim(coalesce(p_message, '')), '');
  if title_text is null then
    title_text := 'Employee submitted sheet changes';
  end if;
  if body_text is null then
    body_text := 'A sales rep submitted worksheet changes for your review.';
  end if;

  org := public.current_org_id();
  loc := coalesce(p_location_id, public.current_location_id());

  insert into public.user_notifications (user_id, location_id, title, message, kind)
  select
    p.id,
    coalesce(loc, p.location_id),
    title_text,
    body_text,
    'pay_sheet'
  from public.user_profiles p
  where p.role = 'manager'
    and p.id is distinct from auth.uid()
    and (
      org is null
      or coalesce(p.org_id, (
        select store.org_id from public.locations store where store.id = p.location_id
      )) = org
    )
    and (loc is null or p.location_id = loc);

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

drop function if exists public.mark_notification_read(uuid);
create or replace function public.mark_notification_read(p_id uuid)
returns public.user_notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row user_notifications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.user_notifications
  set is_read = true
  where id = p_id
    and user_id = auth.uid()
  returning * into found_row;
  if not found then
    raise exception 'Notification not found';
  end if;
  return found_row;
end;
$$;

grant execute on function public.notify_reps_on_pay_push(uuid, text, text) to authenticated;
grant execute on function public.notify_rep_on_sheet_push(uuid, uuid, text, text) to authenticated;
grant execute on function public.notify_location_managers(uuid, text, text) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;

drop policy if exists "Read pay tracker state" on public.pay_tracker_state;
create policy "Read pay tracker state"
  on public.pay_tracker_state for select to authenticated
  using (
    id = auth.uid()
    or user_id = auth.uid()
    or employee_id = auth.uid()
    or public.is_admin()
    or (
      public.is_manager()
      and public.current_location_id() is not null
      and (
        location_id = public.current_location_id()
        or exists (
          select 1
          from public.user_profiles p
          where p.id = coalesce(employee_id, user_id, pay_tracker_state.id)
            and p.location_id = public.current_location_id()
        )
      )
    )
  );

drop policy if exists "Write pay tracker state" on public.pay_tracker_state;
create policy "Write pay tracker state"
  on public.pay_tracker_state for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_location_as(coalesce(employee_id, user_id, id))
    )
  );

drop policy if exists "Update pay tracker state" on public.pay_tracker_state;
create policy "Update pay tracker state"
  on public.pay_tracker_state for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_location_as(coalesce(employee_id, user_id, id))
    )
    or id = auth.uid()
    or user_id = auth.uid()
    or employee_id = auth.uid()
  )
  with check (
    public.is_admin()
    or (
      public.is_manager()
      and public.same_location_as(coalesce(employee_id, user_id, id))
    )
    or id = auth.uid()
    or user_id = auth.uid()
    or employee_id = auth.uid()
  );

drop function if exists public.upsert_pay_tracker_state(uuid, jsonb, text, uuid);
create or replace function public.upsert_pay_tracker_state(
  target_employee uuid,
  payload jsonb,
  p_month_id text default null,
  p_location_id uuid default null
)
returns public.pay_tracker_state
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row pay_tracker_state%rowtype;
  loc uuid;
  month_key text;
  snapshot jsonb;
  resolved uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if target_employee is null then
    raise exception 'Sales rep not found';
  end if;
  if not (public.is_admin() or (public.is_manager() and public.same_location_as(target_employee))) then
    raise exception 'Only the admin or a location manager can push deals';
  end if;

  snapshot := coalesce(payload, '{}'::jsonb);
  month_key := coalesce(
    nullif(p_month_id, ''),
    nullif(snapshot->>'month_id', ''),
    nullif(snapshot->>'monthId', '')
  );
  resolved := coalesce((public.resolve_user_profile(target_employee)).id, target_employee);
  select location_id into loc from public.user_profiles where id = resolved;
  loc := coalesce(p_location_id, loc);

  insert into public.pay_tracker_state (
    id, user_id, employee_id, month_id, status, state, admin_pushed_snapshot, location_id, created_by, updated_at
  ) values (
    resolved,
    resolved,
    resolved,
    month_key,
    'admin_pushed',
    snapshot,
    snapshot,
    loc,
    auth.uid(),
    now()
  )
  on conflict (id) do update
    set
      user_id = excluded.user_id,
      employee_id = excluded.employee_id,
      month_id = excluded.month_id,
      status = 'admin_pushed',
      state = public.pay_tracker_state.state,
      admin_pushed_snapshot = snapshot,
      rep_draft = null,
      approval_diffs = '[]'::jsonb,
      pay_delta = 0,
      finalized_label = null,
      deny_reason = null,
      location_id = coalesce(excluded.location_id, public.pay_tracker_state.location_id),
      created_by = excluded.created_by,
      updated_at = now()
  returning * into found_row;

  return found_row;
end;
$$;

grant execute on function public.upsert_pay_tracker_state(uuid, jsonb, text, uuid) to authenticated;

-- Admin-only master paysheets. Reps have no SELECT policy on this table.
drop policy if exists "Admin read employee sheets" on public.admin_employee_sheets;
create policy "Admin read employee sheets"
  on public.admin_employee_sheets for select to authenticated
  using (
    public.is_admin()
    and (
      org_id = public.current_org_id()
      or org_id is null
      or exists (
        select 1
        from public.user_profiles p
        where p.id = admin_employee_sheets.employee_id
          and coalesce(
            p.org_id,
            (select store.org_id from public.locations store where store.id = p.location_id)
          ) = public.current_org_id()
      )
    )
  );

drop policy if exists "Admin insert employee sheets" on public.admin_employee_sheets;
create policy "Admin insert employee sheets"
  on public.admin_employee_sheets for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admin update employee sheets" on public.admin_employee_sheets;
create policy "Admin update employee sheets"
  on public.admin_employee_sheets for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop function if exists public.upsert_admin_employee_sheet(uuid, jsonb, text, uuid);
create or replace function public.upsert_admin_employee_sheet(
  target_employee uuid,
  payload jsonb,
  p_month_id text default null,
  p_location_id uuid default null
)
returns public.admin_employee_sheets
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row admin_employee_sheets%rowtype;
  found_profile user_profiles%rowtype;
  loc uuid;
  org uuid;
  month_key text;
  snapshot jsonb;
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_admin() then
    raise exception 'Only an admin can edit the master employee sheet';
  end if;
  if target_employee is null then
    raise exception 'Employee not found';
  end if;

  select * into found_profile from public.user_profiles where id = target_employee;
  if not found then
    found_profile := public.resolve_user_profile(target_employee);
  end if;
  if found_profile.id is null then
    raise exception 'Employee not found';
  end if;

  org := public.current_org_id();
  if org is not null and coalesce(
    found_profile.org_id,
    (select store.org_id from public.locations store where store.id = found_profile.location_id)
  ) is distinct from org then
    raise exception 'Employee not found';
  end if;

  snapshot := coalesce(payload, '{}'::jsonb);
  month_key := coalesce(
    nullif(p_month_id, ''),
    nullif(snapshot->>'period_key', ''),
    nullif(snapshot->>'month_id', ''),
    nullif(snapshot->>'monthId', ''),
    'legacy'
  );
  loc := coalesce(p_location_id, found_profile.location_id);
  org := coalesce(
    found_profile.org_id,
    org,
    (select store.org_id from public.locations store where store.id = loc)
  );

  next_status := 'draft';
  select status into next_status
  from public.admin_employee_sheets
  where employee_id = target_employee
    and period_key = month_key;
  if not found then
    next_status := 'draft';
  elsif next_status = 'paid' then
    next_status := 'paid';
  elsif next_status in ('approved_final', 'admin_final_approved', 'manager_approved') then
    next_status := 'draft';
  elsif next_status is distinct from 'pushed' then
    next_status := 'draft';
  end if;

  insert into public.admin_employee_sheets (
    employee_id, org_id, location_id, month_id, period_key, sheet_data, status, created_by, updated_at
  ) values (
    target_employee, org, loc, month_key, month_key, snapshot, next_status, auth.uid(), now()
  )
  on conflict (employee_id, period_key) do update
    set
      org_id = coalesce(excluded.org_id, public.admin_employee_sheets.org_id),
      location_id = coalesce(excluded.location_id, public.admin_employee_sheets.location_id),
      month_id = excluded.month_id,
      period_key = excluded.period_key,
      sheet_data = excluded.sheet_data,
      status = excluded.status,
      updated_at = now()
  returning * into found_row;

  return found_row;
end;
$$;

drop function if exists public.mark_admin_employee_sheet_pushed(uuid);
create or replace function public.mark_admin_employee_sheet_pushed(target_employee uuid)
returns public.admin_employee_sheets
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row admin_employee_sheets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_admin() then
    raise exception 'Only an admin can push the master employee sheet';
  end if;
  if target_employee is null then
    raise exception 'Employee not found';
  end if;

  update public.admin_employee_sheets
  set
    status = 'pushed',
    updated_at = now()
  where employee_id = target_employee
    and status is distinct from 'paid'
  returning * into found_row;

  return found_row;
end;
$$;

drop function if exists public.apply_manager_approval_to_admin_sheet(uuid, jsonb);
create or replace function public.apply_manager_approval_to_admin_sheet(
  target_employee uuid,
  payload jsonb
)
returns public.admin_employee_sheets
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row admin_employee_sheets%rowtype;
  found_profile user_profiles%rowtype;
  loc uuid;
  org uuid;
  month_key text;
  snapshot jsonb;
  payload_empty boolean;
  tracker_snapshot jsonb;
  deal_snapshot jsonb;
  deals_missing boolean;
  attempt int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if target_employee is null then
    raise exception 'Employee not found';
  end if;
  if not (
    public.is_admin()
    or (public.is_manager() and public.same_location_as(target_employee))
  ) then
    raise exception 'Only a manager or admin can lock the master employee sheet';
  end if;

  select * into found_profile from public.user_profiles where id = target_employee;
  if not found then
    found_profile := public.resolve_user_profile(target_employee);
  end if;
  if found_profile.id is null then
    raise exception 'Employee not found';
  end if;

  snapshot := coalesce(payload, '{}'::jsonb);
  for attempt in 1..3 loop
    deals_missing :=
      snapshot is null
      or snapshot = '{}'::jsonb
      or (
        (jsonb_typeof(snapshot->'deals') is distinct from 'array' or jsonb_array_length(coalesce(snapshot->'deals', '[]'::jsonb)) = 0)
        and (jsonb_typeof(snapshot->'records') is distinct from 'array' or jsonb_array_length(coalesce(snapshot->'records', '[]'::jsonb)) = 0)
        and (
          jsonb_typeof(snapshot->'state') is distinct from 'object'
          or jsonb_typeof(snapshot->'state'->'deals') is distinct from 'array'
          or jsonb_array_length(coalesce(snapshot->'state'->'deals', '[]'::jsonb)) = 0
        )
      );
    payload_empty :=
      snapshot is null
      or snapshot = '{}'::jsonb
      or (
        deals_missing
        and (jsonb_typeof(snapshot->'sheets') is distinct from 'array' or jsonb_array_length(coalesce(snapshot->'sheets', '[]'::jsonb)) = 0)
        and (jsonb_typeof(snapshot->'months') is distinct from 'array' or jsonb_array_length(coalesce(snapshot->'months', '[]'::jsonb)) = 0)
        and (jsonb_typeof(snapshot->'staged_data') is distinct from 'array' or jsonb_array_length(coalesce(snapshot->'staged_data', '[]'::jsonb)) = 0)
      );
    exit when not deals_missing;
    exit when not payload_empty and attempt > 1;

    if attempt = 1 then
      select coalesce(
        nullif(pts.rep_draft, 'null'::jsonb),
        nullif(pts.state, 'null'::jsonb),
        nullif(pts.admin_pushed_snapshot, 'null'::jsonb)
      )
      into tracker_snapshot
      from public.pay_tracker_state pts
      where pts.employee_id = found_profile.id
         or pts.user_id = found_profile.id
         or pts.id = found_profile.id
      order by pts.updated_at desc nulls last
      limit 1;
      if tracker_snapshot is not null and tracker_snapshot <> '{}'::jsonb and tracker_snapshot <> 'null'::jsonb then
        snapshot := tracker_snapshot;
        continue;
      end if;
    elsif attempt = 2 then
      select jsonb_build_object(
        'deals', coalesce(jsonb_agg(extracted) filter (where extracted is not null), '[]'::jsonb),
        'records', coalesce(jsonb_agg(extracted) filter (where extracted is not null), '[]'::jsonb),
        'month_id', max(month_from_row)
      )
      into deal_snapshot
      from (
        select
          coalesce(
            case when jsonb_typeof(dr.staged_data -> 'sale') = 'object' then dr.staged_data -> 'sale' end,
            case when jsonb_typeof(dr.proposed_data -> 'sale') = 'object' then dr.proposed_data -> 'sale' end,
            case when jsonb_typeof(dr.live_data -> 'sale') = 'object' then dr.live_data -> 'sale' end,
            case when dr.staged_data ? 'stockNumber' or dr.staged_data ? 'customerName' then dr.staged_data end,
            case when dr.proposed_data ? 'stockNumber' or dr.proposed_data ? 'customerName' then dr.proposed_data end,
            case when dr.live_data ? 'stockNumber' or dr.live_data ? 'customerName' then dr.live_data end
          ) as extracted,
          coalesce(
            dr.staged_data->>'monthId',
            dr.proposed_data->>'monthId',
            dr.live_data->>'monthId'
          ) as month_from_row
        from public.deal_records dr
        where dr.rep_id = found_profile.id
          and coalesce(dr.status::text, '') not in ('rejected', 'rejected_by_manager')
      ) src;
      if deal_snapshot is not null
         and jsonb_typeof(deal_snapshot->'deals') = 'array'
         and jsonb_array_length(deal_snapshot->'deals') > 0 then
        snapshot := deal_snapshot;
        continue;
      end if;
    end if;
  end loop;
  month_key := coalesce(
    nullif(snapshot->>'month_id', ''),
    nullif(snapshot->>'monthId', '')
  );
  loc := found_profile.location_id;
  org := coalesce(
    found_profile.org_id,
    public.current_org_id(),
    (select store.org_id from public.locations store where store.id = loc)
  );

  insert into public.admin_employee_sheets (
    employee_id, org_id, location_id, month_id, sheet_data, status, created_by, updated_at
  ) values (
    found_profile.id, org, loc, month_key, snapshot, 'admin_final_approved', auth.uid(), now()
  )
  on conflict (employee_id) do update
    set
      org_id = coalesce(excluded.org_id, public.admin_employee_sheets.org_id),
      location_id = coalesce(excluded.location_id, public.admin_employee_sheets.location_id),
      month_id = case
        when payload_empty then coalesce(public.admin_employee_sheets.month_id, excluded.month_id)
        else coalesce(excluded.month_id, public.admin_employee_sheets.month_id)
      end,
      sheet_data = case
        when payload_empty then public.admin_employee_sheets.sheet_data
        else excluded.sheet_data
      end,
      status = case
        when public.admin_employee_sheets.status = 'paid' then 'paid'
        else 'admin_final_approved'
      end,
      updated_at = now()
  returning * into found_row;

  return found_row;
end;
$$;

grant execute on function public.upsert_admin_employee_sheet(uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.mark_admin_employee_sheet_pushed(uuid) to authenticated;
grant execute on function public.apply_manager_approval_to_admin_sheet(uuid, jsonb) to authenticated;

drop function if exists public.lock_admin_employee_sheet_approved(uuid);
create or replace function public.lock_admin_employee_sheet_approved(target_employee uuid)
returns public.admin_employee_sheets
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row admin_employee_sheets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if target_employee is null then
    raise exception 'Employee not found';
  end if;
  if not (
    public.is_admin()
    or (public.is_manager() and public.same_location_as(target_employee))
  ) then
    raise exception 'Only a manager or admin can lock the master employee sheet';
  end if;

  update public.admin_employee_sheets
  set
    status = case when status = 'paid' then 'paid' else 'admin_final_approved' end,
    updated_at = now()
  where employee_id = target_employee
  returning * into found_row;

  return found_row;
end;
$$;

grant execute on function public.lock_admin_employee_sheet_approved(uuid) to authenticated;

drop function if exists public.mark_admin_employee_sheet_paid(uuid);
drop function if exists public.mark_admin_employee_sheet_paid(uuid, text);
create or replace function public.mark_admin_employee_sheet_paid(
  target_employee uuid,
  p_period_key text default null
)
returns public.admin_employee_sheets
language plpgsql
security definer
set search_path = public
as $$
declare
  found_row admin_employee_sheets%rowtype;
  period_filter text := nullif(trim(coalesce(p_period_key, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if target_employee is null then
    raise exception 'Employee not found';
  end if;
  if not public.is_admin() then
    raise exception 'Only an admin can mark a pay sheet as paid';
  end if;

  update public.admin_employee_sheets
  set
    status = 'paid',
    is_paid = true,
    paid_at = coalesce(paid_at, now()),
    updated_at = now()
  where employee_id = target_employee
    and lower(coalesce(status, '')) in ('admin_final_approved', 'approved_final', 'manager_approved', 'paid')
    and (
      period_filter is null
      or period_key = period_filter
      or month_id = period_filter
    )
  returning * into found_row;

  if not found then
    raise exception 'Sheet must be finalized before it can be marked paid';
  end if;

  -- Keep the employee snapshot / submission row in sync so the rep UI locks immediately.
  update public.pay_tracker_state
  set
    status = 'paid',
    updated_at = now()
  where coalesce(employee_id, user_id, id) = target_employee
    and (
      period_filter is null
      or month_id = period_filter
      or coalesce(month_id, '') = ''
    );

  update public.deal_records
  set
    status = 'paid',
    updated_at = now()
  where rep_id = target_employee
    and lower(coalesce(status, '')) in (
      'admin_final_approved',
      'approved_final',
      'manager_approved',
      'rep_authorized_no_changes',
      'rep_accepted_no_changes',
      'rep_modified',
      'pending_admin_approval',
      'pending_manager_approval',
      'paid'
    );

  return found_row;
end;
$$;

grant execute on function public.mark_admin_employee_sheet_paid(uuid, text) to authenticated;
grant execute on function public.mark_admin_employee_sheet_paid(uuid) to authenticated;

-- Employees may read only their own lock status (paid / disbursed) for the active period.
drop function if exists public.get_my_admin_sheet_lock_status(text);
create or replace function public.get_my_admin_sheet_lock_status(p_period_key text default null)
returns table(status text, is_paid boolean, period_key text, month_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  period_filter text := nullif(trim(coalesce(p_period_key, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  return query
  select
    aes.status::text,
    coalesce(aes.is_paid, false),
    aes.period_key::text,
    aes.month_id::text
  from public.admin_employee_sheets aes
  where aes.employee_id = auth.uid()
    and (
      period_filter is null
      or aes.period_key = period_filter
      or aes.month_id = period_filter
    )
  order by aes.updated_at desc nulls last
  limit 1;
end;
$$;

grant execute on function public.get_my_admin_sheet_lock_status(text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.organizations;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.user_notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.pay_tracker_state;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.admin_employee_sheets;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
`;
