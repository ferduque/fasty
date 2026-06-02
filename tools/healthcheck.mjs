#!/usr/bin/env node
/**
 * Fasty health check — deterministic pre-ship guardrail.
 *
 * Fasty has no build step and no test suite, so nothing mechanically catches
 * the four ways this app actually breaks before code reaches live users:
 *
 *   1. BROKEN FILE LINKS  — an import / <script src> / <link href> pointing at a
 *      file that was renamed, moved, or mistyped. In a no-build ES-module app
 *      this is a hard white-screen for everyone.
 *   2. SYNTAX ERRORS      — a stray bracket / typo that stops a module loading.
 *   3. CACHE-BUSTER BUG   — the ?v=N tokens in index.html disagree (or are
 *      missing), so visitors keep getting OLD code even after a fix ships.
 *   4. MISSING DOM IDS    — JS reaches for getElementById('x') / querySelector('#x')
 *      where no HTML or JS ever defines that id → silent feature failure.
 *
 * Run it:   node tools/healthcheck.mjs
 * Exit code: 0 = no ERRORS (warnings allowed), 1 = at least one ERROR.
 * The git pre-push hook blocks a push only on ERRORS (exit 1), so warnings
 * never get in your way — they just get reported.
 *
 * Zero dependencies. Node 18+ (uses node:fs, node:path, node:child_process).
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// File discovery — the shipped frontend only (no .git, deps, docs, edge fns).
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.worktrees', 'docs', 'supabase', 'tools', '.claude',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      // Only recurse into src/** ; at root we take only top-level files.
      if (dir === ROOT && name !== 'src') continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(ROOT);
const jsFiles = allFiles.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));
const rel = (f) => relative(ROOT, f);

// ---------------------------------------------------------------------------
// Findings collector
// ---------------------------------------------------------------------------
const findings = []; // { level: 'error'|'warn', category, file, detail }
const err = (category, file, detail) => findings.push({ level: 'error', category, file, detail });
const warn = (category, file, detail) => findings.push({ level: 'warn', category, file, detail });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const read = (f) => readFileSync(f, 'utf8');

// Strip /* block */ and // line comments so commented-out imports don't count.
// Conservative: leaves strings mostly intact (good enough for import detection).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function isExternal(spec) {
  return /^(?:https?:)?\/\//.test(spec) || /^data:/.test(spec) ||
         spec.startsWith('mailto:') || spec.startsWith('#') || spec.startsWith('blob:');
}

// ---------------------------------------------------------------------------
// CHECK 1 — Broken file links (imports + html asset references)
// ---------------------------------------------------------------------------
function extractJsSpecs(src) {
  const specs = [];
  const clean = stripComments(src);
  // static & re-export:  ... from '...'
  for (const m of clean.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  // side-effect:  import '...'
  for (const m of clean.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  // dynamic with STRING LITERAL only:  import('...')  (import(VAR) is skipped)
  for (const m of clean.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  return specs;
}

function extractHtmlSpecs(src) {
  const specs = [];
  for (const m of src.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  // imports inside inline <script type="module"> blocks
  for (const block of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    specs.push(...extractJsSpecs(block[1]));
  }
  return specs;
}

function checkLink(file, rawSpec) {
  if (!rawSpec) return;
  if (isExternal(rawSpec)) return;
  // strip ?query and #hash (covers ?v=37 cache busters)
  const spec = rawSpec.split('?')[0].split('#')[0];
  if (!spec) return;
  // only resolve things that look like a local file reference
  const looksLocal = spec.startsWith('.') || spec.startsWith('/') ||
                     /\.(js|mjs|css|json|svg|png|jpe?g|webp|ico|woff2?|ttf|wasm)$/i.test(spec);
  if (!looksLocal) return;
  const base = spec.startsWith('/') ? ROOT : dirname(file);
  const target = resolve(base, spec.replace(/^\//, ''));
  if (existsSync(target) && statSync(target).isFile()) return;
  // ES modules in the browser require the exact path+extension — no guessing.
  err('broken-link', rel(file), `references "${rawSpec}" → missing file ${rel(target)}`);
}

for (const f of jsFiles) {
  for (const spec of extractJsSpecs(read(f))) checkLink(f, spec);
}
for (const f of htmlFiles) {
  for (const spec of extractHtmlSpecs(read(f))) checkLink(f, spec);
}

// ---------------------------------------------------------------------------
// CHECK 2 — JS syntax errors (force ES-module parse via stdin)
// ---------------------------------------------------------------------------
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'], {
      input: read(f),
      stdio: ['pipe', 'pipe', 'pipe'],
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
// CHECK 3 — Cache-buster consistency in index.html
// ---------------------------------------------------------------------------
const indexPath = join(ROOT, 'index.html');
if (existsSync(indexPath)) {
  const html = read(indexPath);
  const versions = [...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  const distinct = [...new Set(versions)];
  if (versions.length === 0) {
    warn('cache-buster', 'index.html', 'no ?v=N cache-busting query found on any asset');
  } else if (distinct.length > 1) {
    err('cache-buster', 'index.html',
      `mismatched cache versions: ${distinct.map((v) => 'v=' + v).join(', ')} — users may load a stale mix of old + new code`);
  }
  // local .js / .css referenced without a ?v= → soft warning (stale-cache risk)
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) {
    const s = m[1];
    if (isExternal(s)) continue;
    if (/\.(js|css)(\?|#|$)/i.test(s) && !/\?v=\d+/.test(s)) {
      warn('cache-buster', 'index.html', `asset "${s}" has no ?v=N — may serve stale after an update`);
    }
  }
}

// ---------------------------------------------------------------------------
// CHECK 4 — Missing DOM ids (referenced but never defined). WARNING level.
// ---------------------------------------------------------------------------
const referenced = new Map(); // id -> first file that references it
const defined = new Set();

for (const f of htmlFiles) {
  const src = read(f);
  for (const m of src.matchAll(/\bid\s*=\s*['"]([\w-]+)['"]/g)) defined.add(m[1]);
}
for (const f of jsFiles) {
  const src = read(f);
  // ids DEFINED in JS (template HTML, property assignment, setAttribute)
  for (const m of src.matchAll(/\bid\s*=\s*\\?['"]([\w-]+)\\?['"]/g)) defined.add(m[1]);
  for (const m of src.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)) defined.add(m[1]);
  for (const m of src.matchAll(/setAttribute\(\s*['"]id['"]\s*,\s*['"]([\w-]+)['"]\s*\)/g)) defined.add(m[1]);
  // ids REFERENCED
  for (const m of src.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], f);
  }
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*['"]#([\w-]+)['"]\s*\)/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], f);
  }
}
for (const [id, f] of referenced) {
  if (!defined.has(id)) {
    warn('missing-dom-id', rel(f), `references #${id} but no HTML/JS ever defines that id`);
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
  console.log('✅ All clear — no broken links, syntax errors, cache mismatches, or missing DOM ids.');
} else {
  console.log(
    `\nSummary: ${errors.length} error(s), ${warnings.length} warning(s).` +
    (errors.length ? '\n❌ Errors will block a push. Fix them before going live.' :
                     '\n✅ No blocking errors — warnings are advisory.'),
  );
}

// Machine-readable line for the autoresearch loop + the git hook.
console.log(`\nRESULT errors=${errors.length} warnings=${warnings.length} issues=${findings.length}`);

process.exit(errors.length > 0 ? 1 : 0);
