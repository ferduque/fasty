#!/usr/bin/env node
/**
 * Fasty health check — deterministic pre-ship guardrail.
 *
 * Fasty has no build step and no test suite, so nothing mechanically catches
 * the ways this app breaks before code reaches live users. This script does.
 *
 *   1. BROKEN FILE LINKS  — an import / <script src> / <link href> pointing at a
 *      file that was renamed, moved, or mistyped → white-screen.
 *   2. SYNTAX ERRORS      — a stray bracket / typo that stops a module loading.
 *   3. CACHE-BUSTER BUG   — the ?v=N tokens in index.html disagree (or are
 *      missing), so visitors keep getting OLD code after a fix ships.
 *   4. MISSING DOM IDS    — JS reaches for getElementById('x') / querySelector('#x')
 *      where no HTML/JS ever defines that id → silent feature failure.
 *   5. NAMED-EXPORT MISMATCH — `import { foo } from './x.js'` where x.js no longer
 *      exports `foo`. The file exists and parses, so checks 1+2 miss it, but `foo`
 *      is undefined at runtime → TypeError white-screen. (The #1 refactor footgun.)
 *   6. LEAKED SECRETS     — a credential file or secret-shaped string committed to
 *      the repo (which Cloudflare serves publicly).
 *   7. BAD SUPABASE CONFIG — malformed public-config.js silently kills auth,
 *      leaderboard, Pro, and cloud sync with no visible error.
 *   8. DEPLOY OVER-EXPOSURE — wrangler assets.directory='.' without an .assetsignore
 *      serves the entire repo (backend source, docs, config) at getfasty.com.
 *
 * Run it:   node tools/healthcheck.mjs
 * Exit code: 0 = no ERRORS (warnings allowed), 1 = at least one ERROR.
 * The git pre-push hook blocks a push only on ERRORS, so warnings never get in
 * your way — they are advisory.
 *
 * Zero dependencies. Node 18+.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['.git', 'node_modules', '.worktrees', '.claude']);
// Frontend scope (checks 1-5): root top-level files + everything under src/.
const FRONTEND_SKIP = new Set([...SKIP_DIRS, 'docs', 'supabase', 'tools']);

function walk(dir, skip, rootOnlyDirs, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (rootOnlyDirs && dir === ROOT && name !== 'src') continue;
      walk(full, skip, rootOnlyDirs, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const frontendFiles = walk(ROOT, FRONTEND_SKIP, true);
const jsFiles = frontendFiles.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
const htmlFiles = frontendFiles.filter((f) => f.endsWith('.html'));
const rel = (f) => relative(ROOT, f);

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------
const findings = [];
const err = (category, file, detail) => findings.push({ level: 'error', category, file, detail });
const warn = (category, file, detail) => findings.push({ level: 'warn', category, file, detail });
const read = (f) => readFileSync(f, 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function isExternal(spec) {
  return /^(?:https?:)?\/\//.test(spec) || /^data:/.test(spec) ||
         spec.startsWith('mailto:') || spec.startsWith('#') || spec.startsWith('blob:');
}

const STATIC_EXT = /\.(js|mjs|css|json|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|wasm)$/i;

// resolve a local spec to an absolute path, or null if it should be skipped
function resolveLocal(file, rawSpec, { rootAbsoluteStaticOnly = false } = {}) {
  if (!rawSpec || isExternal(rawSpec)) return null;
  const spec = rawSpec.split('?')[0].split('#')[0];
  if (!spec) return null;
  if (spec.startsWith('/')) {
    // root-absolute: a bare /route is likely a client-side route, not a file.
    // Only treat it as a real asset if it carries a known static extension.
    if (rootAbsoluteStaticOnly && !STATIC_EXT.test(spec)) return null;
    return resolve(ROOT, spec.replace(/^\//, ''));
  }
  const looksLocal = spec.startsWith('.') || STATIC_EXT.test(spec);
  if (!looksLocal) return null;
  return resolve(dirname(file), spec);
}

// ---------------------------------------------------------------------------
// CHECK 1 — Broken file links
// ---------------------------------------------------------------------------
function extractJsSpecs(src) {
  const specs = [];
  const clean = stripComments(src);
  for (const m of clean.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of clean.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of clean.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  return specs;
}

function extractHtmlSpecs(src) {
  const specs = [];
  for (const m of src.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const block of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    specs.push(...extractJsSpecs(block[1]));
  }
  return specs;
}

function checkLink(file, rawSpec) {
  const target = resolveLocal(file, rawSpec, { rootAbsoluteStaticOnly: true });
  if (!target) return;
  if (existsSync(target) && statSync(target).isFile()) return;
  err('broken-link', rel(file), `references "${rawSpec}" → missing file ${rel(target)}`);
}

for (const f of jsFiles) for (const spec of extractJsSpecs(read(f))) checkLink(f, spec);
for (const f of htmlFiles) for (const spec of extractHtmlSpecs(read(f))) checkLink(f, spec);

// ---------------------------------------------------------------------------
// CHECK 2 — JS syntax (force ES-module parse via stdin)
// ---------------------------------------------------------------------------
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'], {
      input: read(f), stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    const stderr = (e.stderr ? e.stderr.toString() : '') || e.message || '';
    const line = stderr.split('\n').map((l) => l.trim()).filter(Boolean)
      .find((l) => /Error|Unexpected|Invalid|Missing|SyntaxError/.test(l)) ||
      stderr.split('\n')[0] || 'syntax error';
    err('syntax', rel(f), line.slice(0, 200));
  }
}

// ---------------------------------------------------------------------------
// CHECK 3 — Cache-buster consistency (LOCAL asset refs only)
// ---------------------------------------------------------------------------
const indexPath = join(ROOT, 'index.html');
if (existsSync(indexPath)) {
  const html = read(indexPath);
  const versions = [];
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) {
    const s = m[1];
    if (isExternal(s)) continue;                 // ignore external CDN ?v=
    const v = s.match(/[?&]v=(\d+)/);             // accept ?v= or &v=
    if (v) versions.push(v[1]);
    else if (/\.(js|css)(\?|#|$)/i.test(s)) {
      warn('cache-buster', 'index.html', `asset "${s}" has no ?v=N — may serve stale after an update`);
    }
  }
  const distinct = [...new Set(versions)];
  if (versions.length === 0) {
    warn('cache-buster', 'index.html', 'no ?v=N cache-busting query found on any local asset');
  } else if (distinct.length > 1) {
    err('cache-buster', 'index.html',
      `mismatched cache versions: ${distinct.map((v) => 'v=' + v).join(', ')} — users may load a stale mix of old + new code`);
  }
}

// ---------------------------------------------------------------------------
// CHECK 4 — Missing DOM ids (WARNING level)
// ---------------------------------------------------------------------------
const referenced = new Map();
const defined = new Set();
// HTML id="x" but NOT data-id="x" / data-row-id="x" (boundary before `id`)
const HTML_ID = /(?:^|[\s"'])id\s*=\s*['"]([\w-]+)['"]/g;
for (const f of htmlFiles) for (const m of read(f).matchAll(HTML_ID)) defined.add(m[1]);
for (const f of jsFiles) {
  const src = read(f);
  for (const m of src.matchAll(HTML_ID)) defined.add(m[1]);               // ids in template HTML
  for (const m of src.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)) defined.add(m[1]);
  for (const m of src.matchAll(/setAttribute\(\s*['"]id['"]\s*,\s*['"]([\w-]+)['"]\s*\)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], f);
  }
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*['"]#([\w-]+)['"]\s*\)/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], f);
  }
}
for (const [id, f] of referenced) {
  if (!defined.has(id)) warn('missing-dom-id', rel(f), `references #${id} but no HTML/JS ever defines that id`);
}

// ---------------------------------------------------------------------------
// CHECK 5 — Named-export agreement
// ---------------------------------------------------------------------------
const exportCache = new Map();
function buildExports(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  const clean = stripComments(read(file));
  const names = new Set();
  for (const m of clean.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of clean.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim(); if (!t) continue;
      const seg = t.split(/\s+as\s+/);
      names.add((seg[1] || seg[0]).trim());
    }
  }
  // `export * as ns from './x'` re-exports a namespace under `ns`.
  for (const m of clean.matchAll(/export\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(m[1]);
  const out = {
    names,
    hasDefault: /export\s+default\b/.test(clean),
    // matches both `export * from` and `export * as ns from`
    hasStar: /export\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s+)?from/.test(clean),
  };
  exportCache.set(file, out);
  return out;
}

// split a destructure body into source-side names: {a, b: c, d = 1} -> [a,b,d]
function destructureNames(body) {
  return body.split(',').map((p) => {
    let t = p.trim();
    if (!t || t.startsWith('...')) return null;
    t = t.split(':')[0].split('=')[0].trim();   // key before rename / default
    return /^[A-Za-z_$][\w$]*$/.test(t) ? t : null;
  }).filter(Boolean);
}

function collectImports(src) {
  const clean = stripComments(src);
  const recs = []; // { spec, named:[], wantsDefault:bool }
  // static: import <clause> from 'spec'   (clause may span newlines)
  for (const m of clean.matchAll(/\bimport\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const clause = m[1], spec = m[2];
    if (/^\s*\*\s+as\s+/.test(clause)) continue;              // namespace import — skip
    const named = [];
    const brace = clause.match(/\{([^}]*)\}/);
    if (brace) for (const part of brace[1].split(',')) {
      const t = part.trim(); if (!t) continue;
      named.push(t.split(/\s+as\s+/)[0].trim());              // pre-`as` = source name
    }
    const lead = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    const wantsDefault = /^[A-Za-z_$][\w$]*$/.test(lead);
    recs.push({ spec, named, wantsDefault });
  }
  // dynamic destructure: const { a } = await import('spec')  /  = import('spec')
  for (const m of clean.matchAll(/(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    recs.push({ spec: m[2], named: destructureNames(m[1]), wantsDefault: false });
  }
  // import('spec').then(({ a }) => …)
  for (const m of clean.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\.then\s*\(\s*(?:async\s*)?\(?\s*\{([^{}]*)\}/g)) {
    recs.push({ spec: m[1], named: destructureNames(m[2]), wantsDefault: false });
  }
  return recs;
}

for (const f of jsFiles) {
  for (const rec of collectImports(read(f))) {
    const target = resolveLocal(f, rec.spec);
    if (!target || !existsSync(target) || !statSync(target).isFile()) continue; // CHECK 1 owns missing files
    if (!(target.endsWith('.js') || target.endsWith('.mjs'))) continue;
    const exp = buildExports(target);
    if (exp.hasStar) continue; // re-exports everything — can't statically refute
    for (const name of rec.named) {
      if (!exp.names.has(name)) {
        err('export-mismatch', rel(f), `imports { ${name} } from "${rec.spec}" but ${rel(target)} does not export it`);
      }
    }
    if (rec.wantsDefault && !exp.hasDefault) {
      err('export-mismatch', rel(f), `imports a default from "${rec.spec}" but ${rel(target)} has no default export`);
    }
  }
}

// ---------------------------------------------------------------------------
// CHECK 6 — Leaked secrets (scan the WHOLE repo tree, incl. untracked)
// ---------------------------------------------------------------------------
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|eot|pdf|epub|zip|gz|wasm|mp[34]|mov|svg)$/i;
// Patterns are built so the script never flags its OWN source: each requires
// real secret characters after the prefix, which this file does not contain.
const SECRET_PATTERNS = [
  { name: 'Google OAuth client secret', re: /GOCSPX-[A-Za-z0-9_-]{10,}/ },
  { name: 'Stripe live secret key', re: /sk_live_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe test secret key', re: /sk_test_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe webhook secret', re: /whsec_[A-Za-z0-9]{10,}/ },
  { name: 'PEM private key', re: new RegExp('-----BEGIN [A-Z ]*PRIVATE KEY-----') },
];
const SECRET_FILENAME = /^(client_secret.*\.json|.*credentials.*\.json|service-account.*\.json|.*\.pem)$/i;

function looksServiceRoleJWT(text) {
  for (const m of text.matchAll(/eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      if (payload && payload.role === 'service_role') return true;
    } catch { /* not a JWT */ }
  }
  return false;
}

for (const f of walk(ROOT, SKIP_DIRS, false)) {
  if (f === SELF) continue;                       // never scan our own pattern list
  const name = basename(f);
  if (SECRET_FILENAME.test(name)) {
    err('secret', rel(f), `looks like a credential file committed to the repo (Cloudflare would serve it)`);
    continue;
  }
  if (BINARY_EXT.test(f)) continue;
  let text;
  try { text = read(f); } catch { continue; }
  if (text.length > 2_000_000) continue;
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(text)) { err('secret', rel(f), `contains what looks like a ${p.name}`); break; }
  }
  if (looksServiceRoleJWT(text)) err('secret', rel(f), 'contains a service_role JWT (never expose this client-side)');
}

// ---------------------------------------------------------------------------
// CHECK 7 — Supabase public-config sanity
// ---------------------------------------------------------------------------
const cfgPath = join(ROOT, 'src', 'public-config.js');
if (existsSync(cfgPath)) {
  const s = read(cfgPath);
  const url = (s.match(/SUPABASE_URL\s*[=:]\s*['"]([^'"]+)['"]/) || [])[1];
  const key = (s.match(/SUPABASE_ANON_KEY\s*[=:]\s*['"]([^'"]+)['"]/) || [])[1];
  const placeholder = (v) => !v || /YOUR_|<[^>]*>|placeholder/i.test(v);
  if (placeholder(url) || placeholder(key)) {
    warn('supabase-config', 'src/public-config.js', 'SUPABASE_URL / ANON_KEY look like placeholders (cloud features will be off)');
  } else {
    const urlMatch = url.match(/^https:\/\/([a-z0-9]{8,})\.supabase\.co\/?$/);
    if (!urlMatch) {
      err('supabase-config', 'src/public-config.js', `SUPABASE_URL "${url}" is not a valid https://<ref>.supabase.co URL`);
    }
    const parts = key.split('.');
    if (parts.length !== 3) {
      err('supabase-config', 'src/public-config.js', 'SUPABASE_ANON_KEY is not a valid JWT (expected 3 dot-separated parts)');
    } else {
      try {
        const p = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        if (p.role === 'service_role') {
          err('supabase-config', 'src/public-config.js', 'ANON_KEY is actually a service_role key — this is a SECRET and must never ship to the browser');
        } else if (p.role !== 'anon') {
          warn('supabase-config', 'src/public-config.js', `ANON_KEY role is "${p.role}", expected "anon"`);
        }
        if (urlMatch && p.ref && p.ref !== urlMatch[1]) {
          err('supabase-config', 'src/public-config.js', `ANON_KEY project ref "${p.ref}" does not match the URL ref "${urlMatch[1]}"`);
        }
        if (p.exp && p.exp * 1000 < Date.now()) {
          err('supabase-config', 'src/public-config.js', 'ANON_KEY has expired — sign-in and cloud features will fail');
        }
      } catch {
        err('supabase-config', 'src/public-config.js', 'ANON_KEY payload could not be decoded');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CHECK 8 — Deploy over-exposure (Cloudflare assets)
// ---------------------------------------------------------------------------
const wranglerPath = join(ROOT, 'wrangler.jsonc');
if (existsSync(wranglerPath)) {
  let dir;
  try {
    const cfg = JSON.parse(read(wranglerPath).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1'));
    dir = cfg && cfg.assets && cfg.assets.directory;
  } catch { /* unparseable — leave dir undefined */ }
  if (dir === '.' || dir === '' || dir === './' || (dir && resolve(ROOT, dir) === ROOT)) {
    const ignorePath = join(ROOT, '.assetsignore');
    if (!existsSync(ignorePath)) {
      err('deploy-exposure', 'wrangler.jsonc',
        'assets.directory="." serves the ENTIRE repo publicly. Add a .assetsignore that excludes supabase/, docs/, tools/, *.md, .env*, and secrets.');
    } else {
      const ig = read(ignorePath);
      for (const must of ['supabase', '*.md', '.env', 'client_secret']) {
        if (!ig.includes(must)) {
          warn('deploy-exposure', '.assetsignore', `does not exclude "${must}" — that path may be served publicly`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const errors = findings.filter((f) => f.level === 'error');
const warnings = findings.filter((f) => f.level === 'warn');

const CATEGORY_LABEL = {
  'broken-link': 'Broken file links',
  'syntax': 'Syntax errors',
  'cache-buster': 'Cache-buster issues',
  'missing-dom-id': 'Missing DOM ids',
  'export-mismatch': 'Named-export mismatches',
  'secret': 'Leaked secrets',
  'supabase-config': 'Supabase config problems',
  'deploy-exposure': 'Deploy over-exposure',
};

function printGroup(list, mark) {
  const byCat = {};
  for (const f of list) (byCat[f.category] ??= []).push(f);
  for (const [cat, items] of Object.entries(byCat)) {
    console.log(`\n${mark} ${CATEGORY_LABEL[cat] || cat} (${items.length})`);
    for (const it of items) console.log(`   • ${it.file}: ${it.detail}`);
  }
}

console.log(`\n🔎 Fasty health check — scanned ${jsFiles.length} JS + ${htmlFiles.length} HTML files\n`);
if (errors.length) printGroup(errors, '❌');
if (warnings.length) printGroup(warnings, '⚠️ ');

if (errors.length === 0 && warnings.length === 0) {
  console.log('✅ All clear — no broken links, syntax errors, cache mismatches, missing DOM ids, export mismatches, leaked secrets, or config problems.');
} else {
  console.log(
    `\nSummary: ${errors.length} error(s), ${warnings.length} warning(s).` +
    (errors.length ? '\n❌ Errors will block a push. Fix them before going live.'
                   : '\n✅ No blocking errors — warnings are advisory.'),
  );
}
console.log(`\nRESULT errors=${errors.length} warnings=${warnings.length} issues=${findings.length}`);
process.exit(errors.length > 0 ? 1 : 0);
