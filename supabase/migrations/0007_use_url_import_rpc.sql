create or replace function public.use_url_import()
returns table(allowed boolean, used integer, remaining integer, cap integer)
language plpgsql security definer set search_path = '' as $$
declare
  prof record;
  current_month date := date_trunc('month', now())::date;
  user_cap integer;
  new_used integer;
begin
  select * into prof from public.profiles where user_id = auth.uid() for update;
  if prof is null then
    return query select false, 0, 0, 0;
    return;
  end if;
  if prof.url_imports_month_start <> current_month then
    prof.url_imports_used := 0;
    prof.url_imports_month_start := current_month;
  end if;
  user_cap := case prof.tier when 'pro' then 70 else 3 end;
  if prof.url_imports_used >= user_cap then
    update public.profiles
      set url_imports_month_start = current_month, updated_at = now()
      where user_id = auth.uid();
    return query select false, prof.url_imports_used, 0, user_cap;
    return;
  end if;
  new_used := prof.url_imports_used + 1;
  update public.profiles
    set url_imports_used = new_used,
        url_imports_month_start = current_month,
        updated_at = now()
    where user_id = auth.uid();
  return query select true, new_used, user_cap - new_used, user_cap;
end; $$;

revoke all on function public.use_url_import() from public, anon;
grant execute on function public.use_url_import() to authenticated;
