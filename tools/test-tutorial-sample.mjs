// Zero-dependency assertions for src/tutorial-sample.js (pure logic, no DOM).
import {
  pickLanguage, getTutorialSegments, getCheckpointPrompt, getAnonCardCopy, TUTORIAL_WPM,
} from '../src/tutorial-sample.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); failures++; } };

// Language detection
ok(pickLanguage({ language: 'es-ES', languages: ['es-ES'] }) === 'es', 'es-ES -> es');
ok(pickLanguage({ language: 'es-419' }) === 'es', 'es-419 -> es');
ok(pickLanguage({ language: 'en-US', languages: ['en-US'] }) === 'en', 'en-US -> en');
ok(pickLanguage({ language: 'fr-FR' }) === 'en', 'fr -> en (fallback)');
ok(pickLanguage(null) === 'en', 'no navigator -> en');

// Segments: 3 of them, location token resolved (no leftover braces)
for (const lang of ['es', 'en']) {
  for (const isMobile of [true, false]) {
    const segs = getTutorialSegments({ lang, isMobile });
    ok(Array.isArray(segs) && segs.length === 3, `${lang}/${isMobile}: 3 segments`);
    ok(segs.every(s => typeof s === 'string' && s.trim().length > 0), `${lang}/${isMobile}: non-empty`);
    ok(!segs.join(' ').includes('{location}'), `${lang}/${isMobile}: token resolved`);
    ok(/\bFasty\b/.test(segs[0]), `${lang}/${isMobile}: seg1 names Fasty`);
  }
}

// Device-aware location wording actually differs
ok(getTutorialSegments({ lang: 'es', isMobile: true })[0].includes('arriba'), 'es mobile: arriba');
ok(getTutorialSegments({ lang: 'es', isMobile: false })[0].includes('izquierda'), 'es desktop: izquierda');

// Checkpoint prompt: device-aware (tap vs Space)
ok(/toca/i.test(getCheckpointPrompt({ lang: 'es', isMobile: true })), 'es mobile checkpoint: toca');
ok(/espacio/i.test(getCheckpointPrompt({ lang: 'es', isMobile: false })), 'es desktop checkpoint: Espacio');
ok(/tap/i.test(getCheckpointPrompt({ lang: 'en', isMobile: true })), 'en mobile checkpoint: tap');
ok(/space/i.test(getCheckpointPrompt({ lang: 'en', isMobile: false })), 'en desktop checkpoint: Space');

// Anon card copy has the four fields
for (const lang of ['es', 'en']) {
  const c = getAnonCardCopy({ lang });
  ok(c && c.title && c.body && c.cta && c.dismiss, `${lang}: card has all fields`);
}

ok(TUTORIAL_WPM === 250, 'TUTORIAL_WPM is 250');

if (failures) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
console.log('tutorial-sample: all assertions passed');
