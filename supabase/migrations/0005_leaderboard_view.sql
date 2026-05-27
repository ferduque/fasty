create materialized view public.leaderboard_30d as
select
  p.user_id,
  coalesce(p.display_name, 'Anonymous reader')                        as display_name,
  p.country_code,
  round(avg(rs.wpm))::integer                                          as avg_wpm,
  sum(rs.words_read)                                                    as total_words,
  count(distinct coalesce(rs.document_id::text, rs.paste_session_id::text))
                                                                       as items_read
from public.profiles p
join public.reading_sessions rs on rs.user_id = p.user_id
where p.leaderboard_optin = true
  and rs.started_at > now() - interval '30 days'
group by p.user_id, p.display_name, p.country_code
having sum(rs.words_read) >= 500;

create unique index leaderboard_30d_user_idx    on public.leaderboard_30d(user_id);
create        index leaderboard_30d_wpm_idx     on public.leaderboard_30d(avg_wpm desc);
create        index leaderboard_30d_country_idx on public.leaderboard_30d(country_code, avg_wpm desc);

revoke all on public.leaderboard_30d from public, anon, authenticated;
grant select on public.leaderboard_30d to anon, authenticated;
