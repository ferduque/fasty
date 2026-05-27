-- profiles: one row per auth.users row.
create table public.profiles (
  user_id                 uuid primary key references auth.users on delete cascade,
  tier                    text not null default 'free' check (tier in ('free','pro')),
  display_name            text,
  country_code            text,
  leaderboard_optin       boolean not null default true,
  url_imports_used        integer not null default 0,
  url_imports_month_start date not null default date_trunc('month', now())::date,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles owner read" on public.profiles
  for select using (user_id = auth.uid());

create policy "profiles owner update" on public.profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Lock protected columns (tier + counters + created_at) against client updates.
create or replace function public.lock_profile_protected_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then return new; end if;
  new.tier := old.tier;
  new.url_imports_used := old.url_imports_used;
  new.url_imports_month_start := old.url_imports_month_start;
  new.created_at := old.created_at;
  return new;
end; $$;

drop trigger if exists lock_profile_protected on public.profiles;
create trigger lock_profile_protected
  before update on public.profiles
  for each row execute function public.lock_profile_protected_columns();

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
