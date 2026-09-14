-- Pay Tracker cloud store (one row per signed-in user)
-- Row id must equal auth.uid() so RLS can use: auth.uid() = id

create table if not exists public.pay_tracker_state (
  id uuid primary key,
  state jsonb not null default '{"months":[],"vehicleTypes":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.pay_tracker_state enable row level security;

drop policy if exists "pay tracker read" on public.pay_tracker_state;
drop policy if exists "pay tracker write" on public.pay_tracker_state;
drop policy if exists "pay_tracker_state_select" on public.pay_tracker_state;
drop policy if exists "pay_tracker_state_insert" on public.pay_tracker_state;
drop policy if exists "pay_tracker_state_update" on public.pay_tracker_state;
drop policy if exists "pay_tracker_state_delete" on public.pay_tracker_state;

create policy "pay_tracker_state_select"
  on public.pay_tracker_state
  for select
  to authenticated
  using (auth.uid() = id);

create policy "pay_tracker_state_insert"
  on public.pay_tracker_state
  for insert
  to authenticated
  with check (auth.uid() = id);

create policy "pay_tracker_state_update"
  on public.pay_tracker_state
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
