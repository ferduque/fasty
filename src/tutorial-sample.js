/**
 * Localized, device-aware copy for the "try before signup" tutorial.
 * Pure data + string assembly — NO DOM, NO imports — so it is unit-testable
 * under plain Node (see tools/test-tutorial-sample.mjs).
 */

export const TUTORIAL_WPM = 250;

// Where the speed control lives, by language + device.
const LOCATION = {
  es: { mobile: 'arriba', desktop: 'a la izquierda' },
  en: { mobile: 'at the top', desktop: 'in the left sidebar' },
};

// Three segments per language. `{location}` is resolved per device.
const SEGMENTS = {
  es: [
    '¡Hola! Bienvenido a Fasty. Ahora mismo estás leyendo a 250 palabras por minuto, una a una, sin mover los ojos. ¿Notas lo cómodo que es? Vamos a subir un poco: busca el control de velocidad {location} y cámbialo a 350. Hazlo ahora, te espero.',
    '¿Listo? A 350 palabras por minuto ya vas por encima de lo normal, casi sobrenatural. Y lo mejor: tu comprensión sigue intacta, porque tu cerebro no pierde tiempo saltando de palabra en palabra. Ahora atrévete con 450. Sí, en serio. Cámbialo y vuelve.',
    '¿Sientes la diferencia? A 450 palabras por minuto lees casi el doble de rápido que una persona promedio, y apenas has practicado. Con un poco de costumbre, esta será tu velocidad natural. Eso es Fasty: pega cualquier texto y léelo volando. ¿Quieres importar tus propios PDFs y libros, guardar tu biblioteca y competir en la clasificación? Crea una cuenta gratis. Por ahora, disfruta de tu nueva superpotencia. ¡A leer!',
  ],
  en: [
    "Hi! Welcome to Fasty. Right now you're reading at 250 words per minute, one word at a time, without moving your eyes. Feel how easy that is? Let's go faster: find the speed control {location} and change it to 350. Go ahead, I'll wait.",
    "Ready? At 350 words per minute you're already above normal — a little bit supernatural. And the best part: your comprehension stays intact, because your brain isn't wasting time jumping from word to word. Now dare to try 450. Yes, really. Change it and come back.",
    "Feel the difference? At 450 words per minute you're reading almost twice as fast as the average person — and you've barely practiced. With a little habit, this becomes your natural speed. That's Fasty: paste any text and read it at lightning speed. Want to import your own PDFs and books, save your library, and compete on the leaderboard? Create a free account. For now, enjoy your new superpower. Happy reading!",
  ],
};

const CHECKPOINT = {
  es: { mobile: 'Cambia la velocidad y toca para continuar', desktop: 'Cambia la velocidad y pulsa <kbd>Espacio</kbd> para continuar' },
  en: { mobile: 'Change your speed, then tap to continue', desktop: 'Change your speed, then press <kbd>Space</kbd> to continue' },
};

const CARD = {
  es: {
    title: '¿Te ha gustado?',
    body: 'Crea una cuenta gratis para leer hasta 600 palabras por minuto, importar tus propios PDFs y libros, guardar tu biblioteca y competir en la clasificación.',
    cta: 'Crear cuenta gratis',
    dismiss: 'Ahora no',
  },
  en: {
    title: 'Enjoyed that?',
    body: 'Create a free account to read up to 600 words per minute, import your own PDFs & books, save your library, and join the leaderboard.',
    cta: 'Create free account',
    dismiss: 'Not now',
  },
};

const norm = (lang) => (lang === 'es' ? 'es' : 'en');

/** Pick 'es' for Spanish-language browsers, else 'en'. `nav` injectable for tests. */
export function pickLanguage(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  if (!nav) return 'en';
  const tags = [nav.language, ...(nav.languages || [])].filter(Boolean);
  return tags.some(t => String(t).toLowerCase().startsWith('es')) ? 'es' : 'en';
}

/** Array of 3 segment strings, location token resolved for the device. */
export function getTutorialSegments({ lang, isMobile }) {
  const L = norm(lang);
  const loc = LOCATION[L][isMobile ? 'mobile' : 'desktop'];
  return SEGMENTS[L].map(s => s.replace('{location}', loc));
}

/** Pre-resolved literal HTML for the between-segment checkpoint prompt. */
export function getCheckpointPrompt({ lang, isMobile }) {
  const L = norm(lang);
  return CHECKPOINT[L][isMobile ? 'mobile' : 'desktop'];
}

/** {title, body, cta, dismiss} for the post-read signup card. */
export function getAnonCardCopy({ lang }) {
  return CARD[norm(lang)];
}
