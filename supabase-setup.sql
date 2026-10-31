-- Supabase SQL Editor에서 한 번 실행하세요.
create table if not exists public.pattern_cell_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  pattern_id text not null,
  cell_id text not null,
  checked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, pattern_id, cell_id)
);
create table if not exists public.pattern_thread_colors (
  user_id uuid not null references auth.users(id) on delete cascade,
  pattern_id text not null,
  dmc text not null,
  hex text not null check (hex ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, pattern_id, dmc)
);
alter table public.pattern_cell_progress enable row level security;
alter table public.pattern_thread_colors enable row level security;
create policy "own cell progress" on public.pattern_cell_progress
  for all to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "own thread colors" on public.pattern_thread_colors
  for all to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create index if not exists pattern_cell_progress_lookup on public.pattern_cell_progress (user_id, pattern_id, updated_at);
