#!/usr/bin/env node
// Smoke gate for eq-shell Netlify functions.
//
// GETs every function and FAILS if any CRASHES on load — HTTP 502/504 or a
// Lambda error envelope (`errorType`, `ERR_…`, `Runtime.…`). A clean handler
// response (401/403/404/405/400/200/3xx) means the bundle loaded, which is all
// this asserts. It catches the class of outage where a *green build* still
// ships a function that throws at import time — e.g. the @eq-solutions/roles
// ".ts" bundling 502 that took down 18 functions on 2026-06-02.
//
// Usage:
//   node scripts/smoke-functions.mjs                                  # https://core.eq.solutions
//   node scripts/smoke-functions.mjs https://deploy-preview-N--eq-shell.netlify.app
// Exit 0 = all loaded; exit 1 = one or more crashed/unreachable.

const BASE = (process.argv[2] || 'https://core.eq.solutions').replace(/\/$/, '');
const TIMEOUT_MS = 12000;
const CONCURRENCY = 8;

// All functions EXCEPT cron/side-effectful ones we don't want to poke with a bare GET.
const EXCLUDE = new Set(['quotes-expiry-scheduler', 'backfill-auth-users']);
const FUNCTIONS = [
  'accept-invite','accept-pin-reset','admin-tenants','ai-briefing','asset-calibration',
  'asset-relations','briefing-action','canonical-api','cards-api','cards-approve-staff',
  'cards-pending-staff','challenge-totp','confirm-totp','edit-user','enroll-totp',
  'entity-actions','entity-insert','entity-patch','entity-rows','equipment-list',
  'generate-gm-briefing','gm-chat','gm-reports','intake-commit','invite-user',
  'manage-gm-report','mint-cards-iframe-token','mint-iframe-token','mint-quotes-iframe-token',
  'mint-supabase-jwt','ocr-parse','provision-status','provision-tenant','reset-user-pin',
  'security-groups','select-tenant','shell-login','shell-login-magic-link',
  'shell-login-phone-otp','shell-logout','shell-request-pin-reset','switch-tenant',
  'tenant-dashboard','tenant-routing-health','token-exchange','upload-asset-cert',
  'upload-gm-report','upload-tenant-logo','verify-shell-session',
].filter((f) => !EXCLUDE.has(f));

const CRASH_RE = /"errorType"|"errorMessage"|ERR_[A-Z_]+|Runtime\.|terminated unexpectedly|Cannot find module/i;

async function probe(fn) {
  const url = `${BASE}/.netlify/functions/${fn}`;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.text().catch(() => '');
    const crash = res.status === 502 || res.status === 504 || CRASH_RE.test(body.slice(0, 500));
    return { fn, status: res.status, crash, note: crash ? body.slice(0, 140).replace(/\s+/g, ' ') : '' };
  } catch (e) {
    return { fn, status: 0, crash: true, note: 'unreachable: ' + (e?.message || e) };
  }
}

let idx = 0;
const results = [];
async function worker() { while (idx < FUNCTIONS.length) { results.push(await probe(FUNCTIONS[idx++])); } }
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

results.sort((a, b) => a.fn.localeCompare(b.fn));
for (const r of results) {
  console.log(`[${r.crash ? 'CRASH' : ' ok  '}] ${String(r.status).padStart(3)}  ${r.fn}${r.note ? '  — ' + r.note : ''}`);
}
const crashed = results.filter((r) => r.crash);
console.log(`\n${BASE} — ${results.length} functions, ${crashed.length} crashed.`);
if (crashed.length) {
  console.error(`SMOKE FAILED: ${crashed.map((r) => r.fn).join(', ')}`);
  process.exit(1);
}
console.log('SMOKE PASSED — all functions load.');
