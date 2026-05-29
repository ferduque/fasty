alter table public.profiles
  add column if not exists stripe_payment_intent_id text;

create index if not exists profiles_stripe_payment_intent_id_idx
  on public.profiles(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Lock trigger guards this column too (only service-role webhook can set it).
create or replace function public.lock_profile_protected_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then return new; end if;
  new.tier := old.tier;
  new.url_imports_used := old.url_imports_used;
  new.url_imports_month_start := old.url_imports_month_start;
  new.stripe_customer_id := old.stripe_customer_id;
  new.stripe_payment_intent_id := old.stripe_payment_intent_id;
  new.created_at := old.created_at;
  return new;
end; $$;
