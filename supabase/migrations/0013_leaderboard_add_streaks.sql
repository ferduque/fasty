-- Add current_streak to demo entries.
alter table public.demo_leaderboard_entries
  add column if not exists current_streak integer not null default 0 check (current_streak >= 0);

-- Populate demo streaks with a realistic 3-tier distribution:
-- 5% elite (50-150 day streaks), 15% engaged (10-40), 80% casual (1-9).
update public.demo_leaderboard_entries
set current_streak = case
  when random() < 0.05 then 50 + (random() * 100)::int
  when random() < (0.15 / 0.95) then 10 + (random() * 30)::int
  else 1 + (power(random(), 2) * 8)::int
end
where current_streak = 0;

-- Recreate the materialized view with current_streak.
-- A "reading day" requires >= 100 words AND >= 60 seconds (filters out accidental
-- 5-second sessions). Streak is alive if the most-recent reading day was today
-- or yesterday (UTC); otherwise it's 0.
drop materialized view if exists public.leaderboard_30d;

create materialized view public.leaderboard_30d as
with reading_days as (
  select
    user_id,
    (started_at at time zone 'utc')::date as day
  from public.reading_sessions
  group by user_id, (started_at at time zone 'utc')::date
  having sum(words_read) >= 100 and sum(duration_seconds) >= 60
),
streak_groups as (
  select
    user_id,
    day,
    day + (row_number() over (partition by user_id order by day desc)) * interval '1 day' as group_anchor
  from reading_days
),
current_streaks as (
  select
    user_id,
    count(*)::integer as current_streak
  from streak_groups
  group by user_id, group_anchor
  having max(day) >= (current_date - 1)
)
(
  select
    p.user_id,
    coalesce(p.display_name, 'Anonymous reader')                          as display_name,
    p.country_code,
    round(avg(rs.wpm))::integer                                            as avg_wpm,
    sum(rs.words_read)::integer                                            as total_words,
    count(distinct coalesce(rs.document_id::text, rs.paste_session_id::text))::integer as items_read,
    coalesce(cs.current_streak, 0)                                         as current_streak
  from public.profiles p
  join public.reading_sessions rs on rs.user_id = p.user_id
  left join current_streaks cs on cs.user_id = p.user_id
  where p.leaderboard_optin = true
    and rs.started_at > now() - interval '30 days'
  group by p.user_id, p.display_name, p.country_code, cs.current_streak
  having sum(rs.words_read) >= 500
)
union all
(
  select
    d.id            as user_id,
    d.display_name,
    d.country_code,
    d.avg_wpm,
    d.total_words,
    d.items_read,
    d.current_streak
  from public.demo_leaderboard_entries d
);

create unique index leaderboard_30d_user_idx    on public.leaderboard_30d(user_id);
create        index leaderboard_30d_wpm_idx     on public.leaderboard_30d(avg_wpm desc);
create        index leaderboard_30d_country_idx on public.leaderboard_30d(country_code, avg_wpm desc);
create        index leaderboard_30d_streak_idx  on public.leaderboard_30d(current_streak desc);

revoke all on public.leaderboard_30d from public, anon, authenticated;
grant select on public.leaderboard_30d to anon, authenticated;

refresh materialized view public.leaderboard_30d;
