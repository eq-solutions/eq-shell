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
const TIMEOUT_MS = 60000;
const CONCURRENCY = 4;
// Retry delay for cold-start ECONNRESET ("fetch failed" TypeError). The Lambda
// is already booting from the first request; a 3s pause lets it warm up so the
// retry lands on a live container rather than another dropped connection.
const RETRY_DELAY_MS = 3000;
// Retry delay for cold-start timeout: accept-pin-reset, reset-user-pin, and
// shell-login consistently exceed 30s on a cold Lambda under concurrent load.
// Retry once after a longer pause — the first hit already warmed the container.
const TIMEOUT_RETRY_DELAY_MS = 10000;

// All functions EXCEPT cron/side-effectful ones we don't want to poke with a bare GET.
const EXCLUDE = new Set(['quotes-expiry-scheduler', 'backfill-auth-users']);
const FUNCTIONS = [
  'accept-invite','accept-pin-reset','admin-tenants','ai-briefing','asset-calibration',
  'asset-relations','briefing-action','canonical-api','cards-api','cards-approve-staff',
  'crm-customers','crm-write',
  'cards-pending-staff','challenge-totp','confirm-totp','edit-user','enroll-totp',
  'entity-actions','entity-insert','entity-patch','entity-rows','equipment-list',
  'generate-gm-briefing','gm-chat','gm-reports','intake-commit','invite-user',
  'manage-gm-report','mint-cards-iframe-token','mint-quotes-iframe-token',
  'mint-supabase-jwt','ocr-parse','provision-status','provision-tenant','reset-user-pin',
  'security-groups','select-tenant','shell-login','shell-login-magic-link',
  'shell-login-phone-otp','shell-logout','shell-request-pin-reset','switch-tenant',
  'tenant-dashboard','tenant-routing-health','token-exchange','upload-asset-cert',
  'upload-gm-report','upload-tenant-logo','verify-shell-session',
].filter((f) => !EXCLUDE.has(f));

const CRASH_RE = /"errorType"|"errorMessage"|ERR_[A-Z_]+|Runtime\.|terminated unexpectedly|Cannot find module/i;

async function probeOnce(fn) {
  const url = `${BASE}/.netlify/functions/${fn}`;
  const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.text().catch(() => '');
  const crash = res.status === 502 || res.status === 504 || CRASH_RE.test(body.slice(0, 500));
  return { fn, status: res.status, crash, note: crash ? body.slice(0, 140).replace(/\s+/g, ' ') : '' };
}

async function probe(fn) {
  try {
    return await probeOnce(fn);
  } catch (e) {
    // TypeError ("fetch failed") = network-level failure (ECONNRESET / ECONNREFUSED).
    // Happens on cold-start: Netlify drops the TCP connection while the Lambda
    // container is booting under concurrent load. The container is already
    // warming from the first hit — wait briefly then retry so the second attempt
    // lands on a live Lambda.
    if (e instanceof TypeError) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      try {
        return await probeOnce(fn);
      } catch (e2) {
        return { fn, status: 0, crash: true, note: 'unreachable (after retry): ' + (e2?.message || e2) };
      }
    }
    // TimeoutError = AbortSignal.timeout fired. accept-pin-reset / reset-user-pin /
    // shell-login cold-start past TIMEOUT_MS under concurrent load. Retry once after
    // a longer pause — the first hit warms the container so the second is fast.
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      await new Promise((r) => setTimeout(r, TIMEOUT_RETRY_DELAY_MS));
      try {
        return await probeOnce(fn);
      } catch (e2) {
        return { fn, status: 0, crash: true, note: 'unreachable (after timeout retry): ' + (e2?.message || e2) };
      }
    }
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
