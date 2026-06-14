#!/usr/bin/env node
// CSS coverage gate: fail if an app-owned `eq-*` class is used in JSX
// (className=) but has no CSS rule anywhere. Catches the "CSS dropped in a
// refactor → unstyled element" regression — e.g. PR #127 deleting
// .eq-hub-drawer / the .eq-hub-ai family while the JSX kept using them. A
// green `pnpm run build` does NOT catch that; this does.
//
// Escape hatch: external (eq-ui) component classes and any knowingly-deferred
// backlog go in ALLOW / ALLOW_PREFIX below. Keep that list small and shrinking.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// eq-ui owns these component class families (defined in the @eq-solutions/ui
// package, not in this repo) — treat as defined.
const ALLOW_PREFIX = [
  'eq-button', 'eq-btn', 'eq-badge', 'eq-modal', 'eq-toast', 'eq-tooltip',
  'eq-select', 'eq-checkbox', 'eq-switch', 'eq-skeleton', 'eq-spinner',
  'eq-tokens', 'eq-ui',
];

// UI tidy-up backlog: app classes referenced in JSX with no rule yet (surfaced
// by this lint, 2026-06-03). These are page-specific design work, not quick
// wins — style them and DELETE from this list. New drops outside this set fail.
const ALLOW = new Set([
  // AcceptInvite — the invite page's hero/form is unstyled:
  'eq-login-form', 'eq-login-form-wrap', 'eq-login-form__foot',
  'eq-login-hero', 'eq-login-hero__accent', 'eq-login-hero__eyebrow',
  'eq-login-hero__eyebrow-dot', 'eq-login-hero__foot', 'eq-login-hero__headline',
  'eq-login-hero__main', 'eq-login-hero__sub', 'eq-login-hero__top',
  'eq-login-hero__trust', 'eq-login-hero__trust-sep',
  // Form primitives — admin "New tenant" form + licence-OCR form:
  'eq-card', 'eq-field', 'eq-field__label', 'eq-field__error', 'eq-input', 'eq-field__input',
  // Intake:
  'eq-intake-pivots__head',
  // QuotesSetup root container — unstyled wrapper from the ops-quotes work
  // (deferred; quotes domain owns styling it). Children carry their own layout.
  'eq-quotes__setup',
  // QuotesReports row base class — styling lives entirely in its --won/--lost/
  // --stale/--warn modifiers (W3 Reports commit aeb4a3d); the base row is an
  // intentionally-unstyled hook. Allowlisted to unblock deploys off main.
  'eq-quotes__reports-row',
]);

function walk(dir, exts, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, exts, acc);
    else if (exts.some((x) => p.endsWith(x))) acc.push(p);
  }
  return acc;
}

const tsxFiles = walk('src', ['.tsx']);
const cssFiles = walk('src', ['.css']);
let cssText = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
if (existsSync('public/eq-tokens.css')) cssText += '\n' + readFileSync('public/eq-tokens.css', 'utf8');

const defined = new Set();
for (const m of cssText.matchAll(/\.(eq-[a-z0-9_-]+)/g)) defined.add(m[1]);

// (?<!-) skips eq-* tokens that are part of a CSS custom property, e.g.
// `var(--eq-sky)` appearing in an inline style on a line that ALSO has a
// className. Those are design tokens, not classes — matching them produced a
// false "missing CSS rule" failure. Real classNames are never preceded by `-`.
const CLASS_RE = /(?<!-)\b(eq-[a-z0-9]+(?:-[a-z0-9]+)*(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?)\b/g;
const referenced = new Map(); // class -> "file:line"
for (const f of tsxFiles) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!line.includes('className')) return;
    for (const m of line.matchAll(CLASS_RE)) {
      if (!referenced.has(m[1])) referenced.set(m[1], `${f}:${i + 1}`);
    }
  });
}

const missing = [];
for (const [cls, loc] of referenced) {
  if (defined.has(cls)) continue;
  if (ALLOW.has(cls)) continue;
  if (ALLOW_PREFIX.some((p) => cls === p || cls.startsWith(p))) continue;
  // A modifier (`--x`) inherits its base rule — fine if the base is defined.
  const base = cls.replace(/--[a-z0-9-]+$/, '');
  if (base !== cls && (defined.has(base) || ALLOW.has(base))) continue;
  missing.push({ cls, loc });
}

if (missing.length) {
  console.error('CSS coverage FAILED — app classes used in JSX with no CSS rule:\n');
  for (const m of missing.sort((a, b) => a.cls.localeCompare(b.cls))) {
    console.error(`   .${m.cls}   (${m.loc})`);
  }
  console.error('\nFix: add a rule to a stylesheet, correct the className, or — if external/');
  console.error('deferred — add it to ALLOW in scripts/check-css-coverage.mjs.');
  process.exit(1);
}
console.log(`CSS coverage OK — ${referenced.size} eq-* classes referenced, all resolve.`);
