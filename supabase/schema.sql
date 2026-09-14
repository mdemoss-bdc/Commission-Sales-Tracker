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
  roster_ready boolean not null default false,
  created_at timestamptz default now()
);

-- Multiple admins are allowed. Any admin may promote another user to admin
-- without demoting themselves.
drop index if exists public.single_admin_idx;

alter table public.user_profiles add column if not exists roster_ready boolean not null default false;

-- 3. Staged and live tracker records
do $$ begin
  create type public.record_status as enum (
    'active',
    'draft',
    'staged',
    'pending_rep_review',
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

drop policy if exists "Admin delete profiles" on public.user_profiles;
create policy "Admin delete profiles"
  on public.user_profiles for delete to authenticated
  using (public.is_admin() and id is distinct from auth.uid());

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
    if tg_op = 'INSERT' and new.status::text in ('draft', 'staged', 'pending_rep_review') then
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
    if new.status::text in ('draft', 'staged', 'pending_rep_review', 'pending_manager_approval') then
      new.live_data := '{}'::jsonb;
    end if;
    return new;
  end if;
  if old.status::text in ('staged', 'pending_rep_review', 'pending_manager_approval', 'pending_admin_approval', 'rejected', 'draft') then
    new.live_data := coalesce(old.live_data, '{}'::jsonb);
    if new.status::text not in ('staged', 'pending_rep_review', 'pending_manager_approval', 'rejected', 'draft') then
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

create or replace function public.push_drafts_to_employee(target_rep uuid)
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
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not (public.is_admin() or (public.is_manager() and public.same_location_as(target_rep))) then
    raise exception 'Only the admin or a location manager can push deals';
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

  -- Never assign live_data here. Existing employee records stay intact.
  -- Promote current drafts, then archive older pending rows for the same pay period
  -- so a re-push overwrites the previous unreviewed iteration instead of stacking.
  with upd as (
    update public.deal_records
    set
      status = next_status,
      proposed_data = staged_data,
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
      and status::text in ('staged', 'pending_rep_review', 'pending_manager_approval', 'pending_admin_approval')
      and public.deal_period_key(staged_data, proposed_data, live_data) = any (period_keys);
  end if;

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
      and status::text in ('pending_rep_review', 'staged');
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
    and status::text in ('pending_rep_review', 'staged');
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
      or (
        public.is_manager()
        and public.current_location_id() is not null
        and rec.location_id = public.current_location_id()
      )
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
    if public.is_manager() then
      if public.current_location_id() is null or rec.location_id is distinct from public.current_location_id() then
        raise exception 'Not allowed to lock this deal';
      end if;
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

grant execute on function public.push_drafts_to_employee(uuid) to authenticated;
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
    or (
      public.is_manager()
      and public.current_location_id() is not null
      and rec.location_id = public.current_location_id()
    )
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
      and status::text in ('draft', 'staged', 'pending_rep_review', 'rejected')
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
