alter table public.profiles
  add column if not exists stripe_customer_id text;

-- Extend the lock trigger to also protect stripe_customer_id from client updates.
create or replace function public.lock_profile_protected_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then return new; end if;
  new.tier := old.tier;
  new.url_imports_used := old.url_imports_used;
  new.url_imports_month_start := old.url_imports_month_start;
  new.stripe_customer_id := old.stripe_customer_id;
  new.created_at := old.created_at;
  return new;
end; $$;
