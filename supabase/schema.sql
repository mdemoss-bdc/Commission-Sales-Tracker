-- Pay Tracker cloud store
-- Run once in the Supabase SQL editor.

create table if not exists public.pay_tracker_state (
  id text primary key,
  state jsonb not null default '{"months":[],"vehicleTypes":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.pay_tracker_state enable row level security;

drop policy if exists "pay tracker read" on public.pay_tracker_state;
drop policy if exists "pay tracker write" on public.pay_tracker_state;

create policy "pay tracker read"
  on public.pay_tracker_state
  for select
  to anon, authenticated
  using (true);

create policy "pay tracker write"
  on public.pay_tracker_state
  for all
  to anon, authenticated
  using (true)
  with check (true);

insert into public.pay_tracker_state (id, state)
values ('default', '{"months":[],"vehicleTypes":[]}'::jsonb)
on conflict (id) do nothing;
