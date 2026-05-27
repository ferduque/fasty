create extension if not exists pg_cron;

select cron.schedule(
  'refresh-leaderboard-30d',
  '0 * * * *',
  $$ refresh materialized view concurrently public.leaderboard_30d $$
);
