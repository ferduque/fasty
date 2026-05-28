-- Demo entries that show up on the leaderboard alongside real users.
-- Used to seed the leaderboard so it doesn't feel empty pre-launch.
-- Remove with: delete from public.demo_leaderboard_entries;
create table public.demo_leaderboard_entries (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  country_code text not null,
  avg_wpm      integer not null check (avg_wpm between 50 and 2000),
  total_words  integer not null check (total_words >= 500),
  items_read   integer not null check (items_read >= 1),
  created_at   timestamptz not null default now()
);

alter table public.demo_leaderboard_entries enable row level security;
-- No policies → only service role can read/write. Public access is via the
-- materialized view only (already publicly-readable).

-- Replace the materialized view: UNION real entries with demo entries.
drop materialized view if exists public.leaderboard_30d;

create materialized view public.leaderboard_30d as
(
  select
    p.user_id,
    coalesce(p.display_name, 'Anonymous reader')                          as display_name,
    p.country_code,
    round(avg(rs.wpm))::integer                                            as avg_wpm,
    sum(rs.words_read)::integer                                            as total_words,
    count(distinct coalesce(rs.document_id::text, rs.paste_session_id::text))::integer as items_read
  from public.profiles p
  join public.reading_sessions rs on rs.user_id = p.user_id
  where p.leaderboard_optin = true
    and rs.started_at > now() - interval '30 days'
  group by p.user_id, p.display_name, p.country_code
  having sum(rs.words_read) >= 500
)
union all
(
  select
    d.id          as user_id,
    d.display_name,
    d.country_code,
    d.avg_wpm,
    d.total_words,
    d.items_read
  from public.demo_leaderboard_entries d
);

create unique index leaderboard_30d_user_idx    on public.leaderboard_30d(user_id);
create        index leaderboard_30d_wpm_idx     on public.leaderboard_30d(avg_wpm desc);
create        index leaderboard_30d_country_idx on public.leaderboard_30d(country_code, avg_wpm desc);

revoke all on public.leaderboard_30d from public, anon, authenticated;
grant select on public.leaderboard_30d to anon, authenticated;

-- One-time seed: 839 Spanish-style entries with realistic WPM/words distribution.
insert into public.demo_leaderboard_entries (display_name, country_code, avg_wpm, total_words, items_read)
select
  (array[
    'María L.','Lucas G.','Ana R.','Pablo M.','Sofía F.','Mateo S.','Lucía P.','Martín H.',
    'Diego J.','Alejandro V.','Carmen B.','Sara N.','Daniela C.','Paula A.','Julia G.','Marta R.',
    'Laura M.','Daniel V.','Carlos P.','Miguel S.','Cristina T.','Valeria L.','Adrián D.','Javier B.',
    'Sergio R.','David M.','Beatriz F.','Isabel C.','Andrea G.','Elena T.','ferdub','lectorhabil',
    'libros_y_cafe','leemucho','lectora_es','vidalectora','mar_lectora','jorge_reads','anita_books','paulo_books',
    'raul_lee','page_after_page','fastreader_es','sofia_pages','leyendo_madrid','lectores_bcn','lectorrapido','devoralibros',
    'libro_al_dia','mucholeer','Nicolás R.','Hugo P.','Álvaro G.','Marcos L.','Gonzalo M.','Rubén C.',
    'Iván V.','Patricia S.','Raquel L.','Silvia P.','Teresa M.','Noelia G.','Rocío F.','Pilar B.',
    'Inés D.','Manuel R.','Antonio J.','José M.','Juan F.','Francisco V.','andresito','pedrito_reads',
    'libroteca','sara_libros','maria_books','lectora_madrid','lector_galicia','libreta_letras','mar_palabras','Marina R.',
    'anita_lee','carlitos_r','sergiol','Felipe G.','Lorena R.','Rosa M.','manu_libros','Pedro V.',
    'nico_r','cristian_books','Estela L.','Vega R.','Bruno M.','lola_lecturas','Iria F.','marina_lectora',
    'Eva R.','sofi_m','Aitor S.','Ainara L.'
  ])[1 + ((gs.s - 1) % 100)]
    || case when gs.s <= 100 then '' else '_' || ((gs.s - 1) / 100 + 1)::text end
    as display_name,
  'ES' as country_code,
  case
    when random() < 0.1 then 500 + (random() * 150)::int
    else 260 + (random() * 280)::int
  end as avg_wpm,
  (1000 + power(random(), 3) * 25000)::int as total_words,
  greatest(2, least(15, 2 + (power(random(), 2) * 13)::int)) as items_read
from generate_series(1, 839) gs(s);

refresh materialized view public.leaderboard_30d;
