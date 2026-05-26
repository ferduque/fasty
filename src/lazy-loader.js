/**
 * Load an external <script> once. Resolves when window[globalName] is defined.
 */
const cache = new Map();

export function loadScript(src, globalName) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve, reject) => {
    if (globalName && window[globalName]) return resolve(window[globalName]);
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      if (globalName) {
        if (window[globalName]) resolve(window[globalName]);
        else reject(new Error(`Loaded ${src} but window.${globalName} is undefined`));
      } else {
        resolve();
      }
    };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  cache.set(src, p);
  return p;
}
