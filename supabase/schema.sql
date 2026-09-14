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
  created_at timestamptz default now()
);

-- Multiple admins are allowed. Any admin may promote another user to admin
-- without demoting themselves.
drop index if exists public.single_admin_idx;

-- 3. Staged and live tracker records
do $$ begin
  create type public.record_status as enum (
    'active',
    'draft',
    'staged',
    'pending_manager_approval',
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

create table if not exists public.deal_records (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.user_profiles(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  created_by uuid not null references public.user_profiles(id),
  status public.record_status not null default 'active',
  staged_data jsonb default '{}'::jsonb,
  live_data jsonb not null default '{}'::jsonb,
  proposed_data jsonb not null default '{}'::jsonb,
  rep_notes text,
  reject_reason text,
  updated_at timestamptz default now()
);

create index if not exists deal_records_rep_idx on public.deal_records (rep_id);
create index if not exists deal_records_location_status_idx on public.deal_records (location_id, status);

alter table public.deal_records add column if not exists proposed_data jsonb not null default '{}'::jsonb;
alter table public.deal_records add column if not exists reject_reason text;

-- Enable RLS
alter table public.locations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.deal_records enable row level security;

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

-- Signup default is sales rep. If no admin exists yet, the first profile is
-- stored as admin so the org is not locked out of People / Locations.
create or replace function public.ensure_own_profile()
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.user_profiles;
  has_admin boolean;
  meta_name text;
  meta_location uuid;
  loc_text text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'full_name', '')), ''),
    nullif(trim(coalesce(u.raw_user_meta_data ->> 'location_id', auth.jwt() -> 'user_metadata' ->> 'location_id', '')), '')
  into meta_name, loc_text
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

  if meta_location is not null and not exists (
    select 1 from public.locations where id = meta_location and active = true
  ) then
    meta_location := null;
  end if;

  select * into profile from public.user_profiles where id = auth.uid();
  if found then
    if profile.location_id is null and meta_location is not null then
      update public.user_profiles
      set
        location_id = meta_location,
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

  select exists(select 1 from public.user_profiles where role = 'admin') into has_admin;

  insert into public.user_profiles (id, email, full_name, role, location_id)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', ''),
    coalesce(meta_name, coalesce(auth.jwt() ->> 'email', '')),
    case when has_admin then 'rep'::public.user_role else 'admin'::public.user_role end,
    meta_location
  )
  returning * into profile;

  return profile;
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

create or replace function public.update_own_location_id(p_location_id uuid)
returns public.user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.user_profiles;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_location_id is null then
    raise exception 'Select a dealership store';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id and active = true) then
    raise exception 'That store is not available';
  end if;
  update public.user_profiles
  set location_id = p_location_id
  where id = auth.uid()
  returning * into profile;
  if not found then
    raise exception 'Profile not found';
  end if;
  return profile;
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
grant execute on function public.ensure_own_profile() to authenticated;
grant execute on function public.list_signup_locations() to anon, authenticated;
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
declare
  caller_role public.user_role;
  admin_count integer;
begin
  select role into caller_role
  from public.user_profiles
  where id = auth.uid();

  if caller_role is distinct from 'admin' then
    raise exception 'Only an admin can reassign roles.';
  end if;

  if not exists (select 1 from public.user_profiles where id = target_user_id) then
    raise exception 'User not found';
  end if;

  if target_user_id = auth.uid() and new_role is distinct from 'admin' then
    select count(*) into admin_count from public.user_profiles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'Promote another admin before changing your own role.';
    end if;
  end if;

  update public.user_profiles
  set role = new_role
  where id = target_user_id;
end;
$$;

grant execute on function public.update_user_role(uuid, public.user_role) to authenticated;

grant select on table public.locations to anon, authenticated;
grant select on table public.user_profiles to authenticated;
grant select on table public.deal_records to authenticated;

-- Basic read policies
drop policy if exists "Read locations authenticated" on public.locations;
create policy "Read locations authenticated"
  on public.locations for select to authenticated using (true);

drop policy if exists "Read active locations for signup" on public.locations;
create policy "Read active locations for signup"
  on public.locations for select to anon
  using (active = true);

drop policy if exists "Read user profiles" on public.user_profiles;
create policy "Read user profiles"
  on public.user_profiles for select to authenticated
  using (
    public.is_admin()
    or id = auth.uid()
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
    public.is_admin()
    or rep_id = auth.uid()
    or (
      public.is_manager()
      and public.current_location_id() is not null
      and location_id = public.current_location_id()
    )
  );

-- Write policies
drop policy if exists "Admin write locations" on public.locations;
create policy "Admin write locations"
  on public.locations for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Insert own profile" on public.user_profiles;
create policy "Insert own profile"
  on public.user_profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "Admin update profiles" on public.user_profiles;
create policy "Admin update profiles"
  on public.user_profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

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
      public.is_manager()
      and public.current_location_id() is not null
      and location_id = public.current_location_id()
    )
  )
  with check (
    public.is_admin()
    or rep_id = auth.uid()
    or (
      public.is_manager()
      and public.current_location_id() is not null
      and location_id = public.current_location_id()
    )
  );

drop policy if exists "Delete own or admin deals" on public.deal_records;
create policy "Delete own or admin deals"
  on public.deal_records for delete to authenticated
  using (public.is_admin() or (rep_id = auth.uid() and not public.is_manager()));

-- Reps cannot approve their own deals or overwrite live_data, except Accept As-Is
create or replace function public.guard_deal_record_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if public.is_admin() or public.is_manager() then
    if tg_op = 'INSERT' and new.status::text in ('draft', 'staged') then
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
    if new.status::text in ('draft', 'staged', 'pending_manager_approval') then
      new.live_data := '{}'::jsonb;
    end if;
    return new;
  end if;
  -- Accept As-Is: manager-pushed staged rows may be committed by the rep
  if old.status::text = 'staged' and new.status::text = 'approved' then
    return new;
  end if;
  if old.status::text in ('staged', 'pending_manager_approval', 'rejected', 'draft') then
    new.live_data := coalesce(old.live_data, '{}'::jsonb);
    if new.status::text not in ('staged', 'pending_manager_approval', 'rejected', 'draft') then
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

create or replace function public.push_drafts_to_employee(target_rep uuid)
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
  if not (public.is_admin() or (public.is_manager() and public.same_location_as(target_rep))) then
    raise exception 'Only the admin or a location manager can push deals';
  end if;

  update public.deal_records
  set
    status = 'staged',
    proposed_data = staged_data,
    reject_reason = null,
    updated_at = now()
  where rep_id = target_rep
    and status::text = 'draft';

  get diagnostics updated = row_count;
  return updated;
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
    or (
      public.is_manager()
      and public.current_location_id() is not null
      and rec.location_id = public.current_location_id()
    )
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
    or (
      public.is_manager()
      and public.current_location_id() is not null
      and rec.location_id = public.current_location_id()
    )
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

grant execute on function public.push_drafts_to_employee(uuid) to authenticated;
grant execute on function public.accept_staged_as_is() to authenticated;
grant execute on function public.submit_modified_staged() to authenticated;
grant execute on function public.approve_deal_record(uuid) to authenticated;
grant execute on function public.reject_deal_record(uuid, text) to authenticated;
