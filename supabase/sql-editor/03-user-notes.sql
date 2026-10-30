-- Personal notes: one private label/value list per user (see schema.sql).
create table if not exists public.user_notes (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  notes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_notes enable row level security;

grant select, insert, update, delete on table public.user_notes to authenticated;

drop policy if exists "Read own notes" on public.user_notes;
create policy "Read own notes" on public.user_notes
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Insert own notes" on public.user_notes;
create policy "Insert own notes" on public.user_notes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Update own notes" on public.user_notes;
create policy "Update own notes" on public.user_notes
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Delete own notes" on public.user_notes;
create policy "Delete own notes" on public.user_notes
  for delete to authenticated using (auth.uid() = user_id);

notify pgrst, 'reload schema';
