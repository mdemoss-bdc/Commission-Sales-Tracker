-- FOUND_ROW_SCHEMA paste 2 of 2
-- Copy this ENTIRE file from GitHub Raw after 01-core.sql succeeds.
-- Starts at a complete statement.

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
    nullif(snapshot->>'month_id', ''),
    nullif(snapshot->>'monthId', '')
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
  where employee_id = target_employee;
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
    employee_id, org_id, location_id, month_id, sheet_data, status, created_by, updated_at
  ) values (
    target_employee, org, loc, month_key, snapshot, next_status, auth.uid(), now()
  )
  on conflict (employee_id) do update
    set
      org_id = coalesce(excluded.org_id, public.admin_employee_sheets.org_id),
      location_id = coalesce(excluded.location_id, public.admin_employee_sheets.location_id),
      month_id = excluded.month_id,
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
create or replace function public.mark_admin_employee_sheet_paid(target_employee uuid)
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
    and status in ('admin_final_approved', 'approved_final', 'manager_approved', 'paid')
  returning * into found_row;

  if not found then
    raise exception 'Sheet must be finalized before it can be marked paid';
  end if;

  return found_row;
end;
$$;

grant execute on function public.mark_admin_employee_sheet_paid(uuid) to authenticated;

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
