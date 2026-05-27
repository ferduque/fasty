create table public.waitlist (
  email      text primary key,
  user_id    uuid references auth.users on delete set null,
  source     text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Anyone (authenticated or not) can add themselves; nobody reads it via the client.
create policy "waitlist anyone insert" on public.waitlist
  for insert with check (true);
