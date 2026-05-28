-- Refresh the demo seed: cleaner names (no numbers, no underscores, no "._"
-- patterns), balanced gender, lower WPM cap (max 580), and 50% Spain +
-- 50% spread across 12 other countries.
delete from public.demo_leaderboard_entries;

insert into public.demo_leaderboard_entries (display_name, country_code, avg_wpm, total_words, items_read, current_streak)
with pools as (
  select
    array[
      'María','Lucía','Sofía','Ana','Carmen','Paula','Marta','Sara','Laura','Julia',
      'Daniela','Andrea','Elena','Isabel','Beatriz','Cristina','Valeria','Rocío','Pilar','Inés',
      'Noelia','Patricia','Raquel','Silvia','Teresa','Rosa','Lorena','Lola','Estela','Vega',
      'Marina','Iria','Ainara','Eva','Alba','Irene','Clara','Vera','Giulia','Chiara',
      'Francesca','Aurora','Sophie','Camille','Léa','Manon','Anaïs','Juliette','Anna','Emma',
      'Pablo','Lucas','Mateo','Martín','Diego','Alejandro','Daniel','Carlos','Miguel','Adrián',
      'Javier','Sergio','David','Manuel','Antonio','Juan','Francisco','Iván','Rubén','Álvaro',
      'Marcos','Hugo','Nicolás','Gonzalo','Felipe','Pedro','Aitor','Bruno','Mario','Andrés',
      'Sebastián','Tomás','Fernando','Raúl','Eduardo','Roberto','Joaquín','Ricardo','Cristian','Marco',
      'Luca','Lorenzo','Stefano','Matteo','Riccardo','Francesco','Pierre','Antoine','Léo','Théo'
    ] as firsts,
    array['L','G','R','M','F','S','B','C','P','V','H','T','D','J','N','A','K'] as initials,
    array[
      'lectorhabil','leemucho','vidalectora','mucholeer','lectorrapido','devoralibros','libroaldia',
      'fastreader','pageturner','bookworm','wordhungry','speedreads','rapidoreads','librosycafe',
      'leyendomadrid','lectoresbcn','jorgereads','paulobooks','anitabooks','rauleereads','paulpages',
      'sofiapages','pageafterpages','lectoramadrid','lectorgalicia','libretaletras','marpalabras',
      'anitalee','sergiolee','manulibros','cristianbooks','lolaslecturas','marinalectora','andresito',
      'pedritoreads','libroteca','saralibros','mariabooks','sergisreads','librouniverso','libroteo',
      'lectorhambriento','librocadadia','fastreaders','rapidlee','wordwizard','pageguru','storynerd',
      'librorush','wordquest','novelchamp','speedyreader','bookwitch','librozillas','wordcraze',
      'rapidreader','pageeater','inkdreamer','novellush','wordsmith','librowizard','pageone',
      'novelheads','storyfaster','speedstack','rapidpages','wordmagic','turnpages','inkwizard',
      'wordfever','novellover','pagedevourer','libroduerme','devorapaginas','lectorsinpausa',
      'mileslecturas','librosporlavida','novelnomad','pagepilot','fastpages','wordvelocity',
      'rapidreading','wordwarp','pagehustle','speedybook','librofiesta','wordsavvy','pageninja',
      'novellauncher','librorocket','fastliterate','rapidwords','wordvoyager','novelvelocity',
      'pagehunter','rapidlettered','inkfast','bookhustle','wordreaper','pagewinner','novelnut',
      'rapidpager','readingmonster','bookcrush','wordhustle','speedlibros','rapidolibros',
      'lectoradiario','librosanonimo','manuscritor','letrafiel','letrazas','letralista','letrapaisa',
      'storyhungry','plotweaver','chapterhunter','tomesprinter','novelnerd','printrush','tomedaily',
      'paperchaser','pagepicker','readingjet','tomerush','sprintlector','readingrunner','readingpower',
      'novelpower','bookblitz','libroliteral','letrarapida','letraviva','letraplena','librolife',
      'lectorflash','flashreader','swiftpages','swiftlector','readingace','aceofbooks','bookbeagle',
      'beaglereads','quickpagess','rapidchapter','chapterace','readerexpress'
    ] as handles
)
select
  case
    when random() < 0.35 then
      pools.firsts[1 + floor(random() * array_length(pools.firsts, 1))::int]
      || ' ' ||
      pools.initials[1 + floor(random() * array_length(pools.initials, 1))::int]
    when random() < 0.6 then
      pools.firsts[1 + floor(random() * array_length(pools.firsts, 1))::int]
    else
      pools.handles[1 + floor(random() * array_length(pools.handles, 1))::int]
  end as display_name,
  case
    when random() < 0.5 then 'ES'
    else (array['MX','AR','CO','CL','PE','BR','FR','IT','PT','DE','GB','US'])[1 + floor(random() * 12)::int]
  end as country_code,
  -- WPM: 70% casual 280-420, 25% engaged 420-500, 5% elite 500-580
  case
    when random() < 0.05 then 500 + (random() * 80)::int
    when random() < (0.25 / 0.95) then 420 + (random() * 80)::int
    else 280 + (random() * 140)::int
  end as avg_wpm,
  (1000 + power(random(), 3) * 25000)::int as total_words,
  greatest(2, least(15, 2 + (power(random(), 2) * 13)::int)) as items_read,
  case
    when random() < 0.05 then 50 + (random() * 100)::int
    when random() < (0.15 / 0.95) then 10 + (random() * 30)::int
    else 1 + (power(random(), 2) * 8)::int
  end as current_streak
from generate_series(1, 839) gs(s)
cross join pools;

refresh materialized view public.leaderboard_30d;
