-- Pay Tracker org, roles, and staged/live deals
-- Run in the Supabase SQL editor. Safe to re-run.

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

create table if not exists public.deal_records (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.user_profiles(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  created_by uuid not null references public.user_profiles(id),
  status public.record_status not null default 'active',
  staged_data jsonb default '{}'::jsonb,
  live_data jsonb not null default '{}'::jsonb,
  proposed_data jsonb not null default '{}'::jsonb,
  previous_data jsonb not null default '{}'::jsonb,
  rep_notes text,
  reject_reason text,
  updated_at timestamptz default now()
);

create index if not exists deal_records_rep_idx on public.deal_records (rep_id);
create index if not exists deal_records_location_status_idx on public.deal_records (location_id, status);

alter table public.deal_records add column if not exists proposed_data jsonb not null default '{}'::jsonb;
alter table public.deal_records add column if not exists previous_data jsonb not null default '{}'::jsonb;
alter table public.deal_records add column if not exists reject_reason text;

-- Enable RLS
alter table public.locations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.deal_records enable row level security;
alter table public.organizations enable row level security;

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
  rec public.organizations;
  org uuid;
begin
  if auth.uid() is null then
    return null;
  end if;

  org := public.current_org_id();
  if org is not null then
    select * into rec from public.organizations where id = org;
  end if;

  if rec.id is null then
    select * into rec
    from public.organizations
    where created_by = auth.uid()
    order by created_at
    limit 1;
  end if;

  if rec.id is null and public.is_admin() then
    select * into rec
    from public.organizations
    order by created_at
    limit 1;
  end if;

  if rec.id is null then
    return null;
  end if;

  update public.user_profiles
  set org_id = rec.id
  where id = auth.uid()
    and org_id is null;

  return rec;
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
  profile public.user_profiles;
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
  rec public.organizations;
  store_list jsonb;
begin
  cleaned := upper(trim(coalesce(input_code, '')));
  if cleaned = '' then
    return null;
  end if;
  select * into rec from public.organizations where upper(join_code) = cleaned;
  if not found then
    return null;
  end if;
  select coalesce(
    jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.name),
    '[]'::jsonb
  )
  into store_list
  from public.locations l
  where l.active = true and l.org_id = rec.id;
  return jsonb_build_object(
    'org_id', rec.id,
    'org_name', rec.name,
    'join_code', rec.join_code,
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
  rec public.organizations;
  loc public.locations;
  profile public.user_profiles;
  next_role public.user_role;
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

  select * into rec from public.organizations where upper(join_code) = cleaned;
  if not found then
    raise exception 'Invalid dealership code.';
  end if;

  select * into loc
  from public.locations
  where id = target_location_id and active = true;
  if not found or loc.org_id is distinct from rec.id then
    raise exception 'Select a store in that dealership group';
  end if;

  select * into profile from public.user_profiles where id = auth.uid();
  was_unlinked := not found or profile.org_id is null;
  profile := public.ensure_own_profile(target_location_id);

  if profile.org_id is not null and profile.org_id is distinct from rec.id then
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
    org_id = rec.id,
    location_id = loc.id,
    role = next_role
  where id = auth.uid()
  returning * into profile;

  org_id := rec.id;
  org_name := rec.name;
  location_id := loc.id;
  return next;
end;
$$;

-- Collision-free 6-character share codes (A–Z, 0–9).
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
  rec public.organizations;
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
  returning * into rec;
  if not found then
    raise exception 'Organization not found';
  end if;
  return rec;
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
  rec public.organizations;
  profile public.user_profiles;
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
    returning * into rec;
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
      returning * into rec;
  end;

  if has_profile then
    update public.user_profiles
    set
      role = 'admin',
      full_name = cleaned_admin,
      org_id = rec.id,
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
      rec.id
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
  rec public.organizations;
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
  returning * into rec;
  if not found then
    raise exception 'Organization not found';
  end if;
  return rec;
end;
$$;

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
  profile public.user_profiles;
  loc public.locations;
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

create or replace function public.update_own_email(new_email text)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.user_profiles;
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

create or replace function public.update_own_full_name(new_name text)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.user_profiles;
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
  caller_role public.user_role;
  rec public.user_profiles;
  loc public.locations;
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

  select * into rec from public.user_profiles where id = target_user_id;
  if not found then
    raise exception 'User not found';
  end if;

  if coalesce(
    rec.org_id,
    (select store.org_id from public.locations store where store.id = rec.location_id)
  ) is distinct from public.current_org_id() then
    raise exception 'User not found';
  end if;

  if target_user_id = auth.uid() and new_role is distinct from rec.role then
    raise exception 'You cannot change your own role.';
  end if;

  if lower(coalesce(rec.email, '')) = 'matthewdemoss@mosescars.com' and new_role is distinct from 'admin' then
    raise exception 'That account is locked as Admin.';
  end if;

  if new_role = 'manager' and target_location_id is null then
    raise exception 'Select a location when assigning a Manager.';
  end if;

  next_org := rec.org_id;
  if target_location_id is not null then
    select * into loc from public.locations where id = target_location_id and active = true;
    if not found then
      raise exception 'That store is not available';
    end if;
    if loc.org_id is distinct from public.current_org_id() then
      raise exception 'That store is not available';
    end if;
    next_org := coalesce(loc.org_id, rec.org_id, public.current_org_id());
  end if;

  update public.user_profiles
  set
    role = new_role,
    location_id = target_location_id,
    org_id = next_org,
    custom_role_id = case
      when new_role in ('admin', 'manager') then null
      else rec.custom_role_id
    end
  where id = target_user_id
  returning * into rec;

  return rec;
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
  rec public.user_profiles;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select * into rec from public.user_profiles where id = target_user_id;
  if not found then
    raise exception 'User not found';
  end if;
  return public.admin_set_user_assignment(target_user_id, rec.role, target_location_id);
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

create or replace function public.delete_user_by_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role public.user_role;
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

  delete from public.user_profiles
  where id = target_user_id;

  delete from auth.users
  where id = target_user_id;
end;
$$;

grant execute on function public.delete_user_by_admin(uuid) to authenticated;

grant select on table public.locations to anon, authenticated;
grant select on table public.user_profiles to authenticated;
grant select on table public.deal_records to authenticated;
grant select on table public.organizations to authenticated;
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
  using (public.is_admin() or (rep_id = auth.uid() and not public.is_manager()));

-- Manager/admin drafts never overwrite live_data. Rep confirmation submits to
-- the manager queue without writing live_data. Only admin final approval
-- (status active/approved) may merge staged_data into live_data.
create or replace function public.guard_deal_record_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if public.is_admin() or public.is_manager() then
    if tg_op = 'INSERT' and new.status::text in ('draft', 'staged', 'pending_rep_review', 'awaiting_review') then
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
    if new.status::text in ('draft', 'staged', 'pending_rep_review', 'awaiting_review', 'pending_manager_approval') then
      new.live_data := '{}'::jsonb;
    end if;
    return new;
  end if;
  if old.status::text in ('staged', 'pending_rep_review', 'awaiting_review', 'pending_manager_approval', 'pending_admin_approval', 'rejected', 'draft') then
    new.live_data := coalesce(old.live_data, '{}'::jsonb);
    if new.status::text not in ('staged', 'pending_rep_review', 'awaiting_review', 'pending_manager_approval', 'rejected', 'draft') then
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

create or replace function public.same_location_as(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles actor
    join public.user_profiles other on other.id = target
    where actor.id = auth.uid()
      and actor.location_id is not null
      and actor.location_id = other.location_id
  );
$$;

grant execute on function public.same_location_as(uuid) to authenticated;

-- Pay-period identity used to collapse stacked submissions for the same rep.
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

drop function if exists public.push_drafts_to_employee(uuid);

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
  next_status public.record_status;
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

  -- Apply the full worksheet payload (deals, vacation, bonuses) as drafts first.
  if payload is not null and payload <> '{}'::jsonb then
    if jsonb_typeof(payload->'records') = 'array' then
      for rec_payload in select value from jsonb_array_elements(payload->'records')
      loop
        kind := rec_payload->>'kind';
        entity_id := rec_payload->>'entityId';
        if kind is null or entity_id is null or kind = '' or entity_id = '' then
          continue;
        end if;
        existing_id := null;
        select r.id into existing_id
        from public.deal_records r
        where r.rep_id = target_rep
          and r.status::text = 'draft'
          and r.staged_data->>'kind' = kind
          and r.staged_data->>'entityId' = entity_id
        limit 1;
        if existing_id is not null then
          update public.deal_records
          set
            staged_data = rec_payload,
            created_by = actor,
            location_id = coalesce(loc, location_id),
            updated_at = now()
          where id = existing_id;
        else
          insert into public.deal_records (
            rep_id, location_id, created_by, status, staged_data, live_data
          ) values (
            target_rep, loc, actor, 'draft', rec_payload, '{}'::jsonb
          );
        end if;
      end loop;
    end if;

    if jsonb_typeof(payload->'sheets') = 'array' then
      for sheet in select value from jsonb_array_elements(payload->'sheets')
      loop
        hours := coalesce(nullif(sheet->>'vacation_hours', '')::numeric, 0);
        rate := coalesce(nullif(sheet->>'hourly_rate', '')::numeric, 0);
        pay := coalesce(nullif(sheet->>'vacation_pay', '')::numeric, hours * rate);
        update public.deal_records
        set staged_data = staged_data || jsonb_build_object(
          'vacationHours', hours,
          'vacationRate', rate,
          'vacationPay', pay,
          'vacation_hours', hours,
          'vacation_rate', rate,
          'vacation_pay', pay,
          'bonuses', coalesce(sheet->'bonuses', '[]'::jsonb)
        )
        where rep_id = target_rep
          and status::text = 'draft'
          and staged_data->>'kind' = 'sheet'
          and (
            staged_data->>'sheetId' = sheet->>'sheetId'
            or staged_data->>'entityId' = sheet->>'sheetId'
          );
      end loop;
    elsif payload ? 'vacation_hours' or payload ? 'bonuses' or payload ? 'hourly_rate' then
      hours := coalesce(nullif(payload->>'vacation_hours', '')::numeric, 0);
      rate := coalesce(nullif(payload->>'hourly_rate', '')::numeric, 0);
      pay := coalesce(nullif(payload->>'vacation_pay', '')::numeric, hours * rate);
      update public.deal_records
      set staged_data = staged_data || jsonb_build_object(
        'vacationHours', hours,
        'vacationRate', rate,
        'vacationPay', pay,
        'vacation_hours', hours,
        'vacation_rate', rate,
        'vacation_pay', pay,
        'bonuses', coalesce(payload->'bonuses', '[]'::jsonb)
      )
      where rep_id = target_rep
        and status::text = 'draft'
        and staged_data->>'kind' = 'sheet';
    end if;
  end if;

  next_status := 'staged'::public.record_status;
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'record_status'
      and e.enumlabel = 'pending_rep_review'
  ) then
    next_status := 'pending_rep_review'::public.record_status;
  end if;
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'record_status'
      and e.enumlabel = 'awaiting_review'
  ) then
    next_status := 'awaiting_review'::public.record_status;
  end if;

  -- Never assign live_data here. Existing employee records stay intact.
  -- Promote current drafts, then archive older pending rows for the same pay period
  -- so a re-push overwrites the previous unreviewed iteration instead of stacking.
  with upd as (
    update public.deal_records
    set
      status = next_status,
      proposed_data = staged_data,
      location_id = coalesce(loc, location_id),
      reject_reason = null,
      updated_at = now()
    where rep_id = target_rep
      and status::text = 'draft'
    returning id, public.deal_period_key(staged_data, proposed_data, live_data) as period
  )
  select
    coalesce(array_agg(id), '{}'::uuid[]),
    coalesce(array_agg(distinct period), '{}'::text[])
  into pushed_ids, period_keys
  from upd;

  updated := coalesce(cardinality(pushed_ids), 0);

  if updated > 0 then
    update public.deal_records
    set
      status = 'rejected',
      reject_reason = 'Superseded by a newer submission',
      staged_data = '{}'::jsonb,
      proposed_data = '{}'::jsonb,
      previous_data = '{}'::jsonb,
      updated_at = now()
    where rep_id = target_rep
      and not (id = any (pushed_ids))
      and status::text in ('staged', 'pending_rep_review', 'awaiting_review', 'pending_manager_approval', 'pending_admin_approval')
      and public.deal_period_key(staged_data, proposed_data, live_data) = any (period_keys);
  end if;

  return updated;
end;
$$;

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
    reject_reason = null,
    updated_at = now()
  where rep_id = target_rep
    and status::text in ('pending_rep_review', 'awaiting_review', 'staged');
  get diagnostics updated = row_count;

  update public.user_profiles
  set roster_ready = false
  where id = target_rep
    and coalesce(roster_ready, false) = true
    and not exists (
      select 1
      from public.deal_records d
      where d.rep_id = target_rep
        and d.status::text in ('pending_manager_approval', 'pending_admin_approval', 'approved', 'active')
    );

  return updated;
end;
$$;

-- Confirming a rep review submits chosen values to the manager queue.
-- live_data stays frozen. previous_data stores the manager's original push
-- (empty for brand-new deals the rep accepted). Status is always
-- pending_manager_approval -- never pending_rep_review / pending_employee_review.
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
  rec public.deal_records;
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
    select * into rec
    from public.deal_records
    where id = (item ->> 'id')::uuid
      and rep_id = target_rep
      and status::text in ('pending_rep_review', 'awaiting_review', 'staged');
    if not found then
      continue;
    end if;

    live_id := nullif(item ->> 'live_id', '')::uuid;
    resolved := item -> 'live_data';
    if resolved is null or resolved = 'null'::jsonb then
      resolved := rec.staged_data;
    end if;

    if action = 'decline' then
      if live_id is not null and live_id is distinct from rec.id then
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
      if rec.live_data is null or rec.live_data = empty_json then
        delete from public.deal_records where id = rec.id and rep_id = target_rep;
      else
        update public.deal_records
        set
          staged_data = empty_json,
          proposed_data = empty_json,
          previous_data = empty_json,
          status = 'active',
          reject_reason = null,
          updated_at = now()
        where id = rec.id;
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
      prior := coalesce(item -> 'previous_data', rec.staged_data, empty_json);
    end if;

    if live_id is not null and live_id is distinct from rec.id then
      update public.deal_records
      set
        staged_data = coalesce(resolved, rec.staged_data),
        proposed_data = prior,
        previous_data = prior,
        status = 'pending_manager_approval',
        reject_reason = null,
        updated_at = now()
      where id = live_id
        and rep_id = target_rep;
      if rec.live_data is null or rec.live_data = empty_json then
        delete from public.deal_records where id = rec.id and rep_id = target_rep;
      else
        update public.deal_records
        set
          staged_data = empty_json,
          proposed_data = empty_json,
          previous_data = empty_json,
          status = 'active',
          reject_reason = null,
          updated_at = now()
        where id = rec.id;
      end if;
    else
      update public.deal_records
      set
        staged_data = coalesce(resolved, rec.staged_data),
        proposed_data = prior,
        previous_data = prior,
        status = 'pending_manager_approval',
        reject_reason = null,
        updated_at = now()
      where id = rec.id;
    end if;
    keep_id := coalesce(live_id, rec.id);
    keep_ids := array_append(keep_ids, keep_id);
    period_keys := array_append(
      period_keys,
      public.deal_period_key(coalesce(resolved, rec.staged_data), prior, rec.live_data)
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
    and status::text in ('pending_rep_review', 'awaiting_review', 'staged');
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

create or replace function public.approve_deal_record(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.deal_records;
begin
  select * into rec from public.deal_records where id = target_id;
  if not found then
    raise exception 'Deal not found';
  end if;
  if not (
    public.is_admin()
    or public.manager_covers_deal(rec.location_id, rec.rep_id)
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

create or replace function public.reject_deal_record(target_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.deal_records;
begin
  select * into rec from public.deal_records where id = target_id;
  if not found then
    raise exception 'Deal not found';
  end if;
  if not (
    public.is_admin()
    or public.manager_covers_deal(rec.location_id, rec.rep_id)
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

create or replace function public.forward_deals_to_admin(target_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.deal_records;
  target uuid;
  updated integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  foreach target in array coalesce(target_ids, '{}'::uuid[])
  loop
    select * into rec from public.deal_records where id = target;
    if not found then
      continue;
    end if;
    if rec.status::text not in ('pending_manager_approval', 'pending_admin_approval') then
      continue;
    end if;
    if not (
      public.is_admin()
      or public.manager_covers_deal(rec.location_id, rec.rep_id)
    ) then
      raise exception 'Not allowed to forward this deal';
    end if;
    update public.deal_records
    set
      live_data = case
        when staged_data is not null and staged_data <> '{}'::jsonb then staged_data
        else live_data
      end,
      staged_data = '{}'::jsonb,
      proposed_data = '{}'::jsonb,
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

create or replace function public.final_approve_deals(target_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.deal_records;
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
    select * into rec from public.deal_records where id = target;
    if not found then
      continue;
    end if;
    if rec.status::text not in ('pending_admin_approval', 'pending_manager_approval') then
      continue;
    end if;
    if public.is_manager() and not public.manager_covers_deal(rec.location_id, rec.rep_id) then
      raise exception 'Not allowed to lock this deal';
    end if;
    update public.deal_records
    set
      live_data = case
        when staged_data is not null and staged_data <> empty_json then staged_data
        else live_data
      end,
      staged_data = empty_json,
      proposed_data = empty_json,
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

create or replace function public.return_deals_to_manager(target_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.deal_records;
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
    select * into rec from public.deal_records where id = target;
    if not found then
      continue;
    end if;
    if rec.status::text is distinct from 'pending_admin_approval' then
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

-- Manager skip/authorize: mark the rep ready and move in-flight rows to
-- pending_manager_approval without waiting on employee confirmation.
create or replace function public.manager_override_rep_ready(target_rep uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.user_profiles;
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

  select * into rec from public.user_profiles where id = target_rep;
  if not found or rec.role is distinct from 'rep' then
    raise exception 'Sales rep not found';
  end if;
  if not (
    public.is_admin()
    or public.manager_covers_deal(rec.location_id, rec.id)
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
    where rep_id = target_rep
      and status::text in ('draft', 'staged', 'pending_rep_review', 'awaiting_review', 'rejected')
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
    where rep_id = target_rep
      and not (id = any (keep_ids))
      and status::text in ('pending_manager_approval', 'pending_admin_approval')
      and public.deal_period_key(staged_data, proposed_data, live_data) = any (period_keys);
  end if;

  update public.user_profiles
  set roster_ready = true
  where id = target_rep;
end;
$$;

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
    live_data = case
      when staged_data is not null and staged_data <> empty_json then staged_data
      else live_data
    end,
    staged_data = empty_json,
    proposed_data = empty_json,
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

create index if not exists user_notifications_user_unread_idx
  on public.user_notifications (user_id, is_read, created_at desc);

alter table public.user_notifications enable row level security;

grant select, update on table public.user_notifications to authenticated;

drop policy if exists "Read own notifications" on public.user_notifications;
create policy "Read own notifications"
  on public.user_notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Update own notifications" on public.user_notifications;
create policy "Update own notifications"
  on public.user_notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

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
  rec public.user_notifications;
  title_text text;
  body_text text;
  org uuid;
  loc uuid;
  target public.user_profiles;
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
  if not found or target.role is distinct from 'rep' then
    raise exception 'Sales rep not found';
  end if;
  if coalesce(target.org_id, (
    select store.org_id from public.locations store where store.id = target.location_id
  )) is distinct from org then
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
  values (p_user_id, loc, title_text, body_text, 'pay_sheet')
  returning * into rec;
  return rec;
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
  rec public.user_notifications;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.user_notifications
  set is_read = true
  where id = p_id
    and user_id = auth.uid()
  returning * into rec;
  if not found then
    raise exception 'Notification not found';
  end if;
  return rec;
end;
$$;

grant execute on function public.notify_reps_on_pay_push(uuid, text, text) to authenticated;
grant execute on function public.notify_rep_on_sheet_push(uuid, uuid, text, text) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;

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
