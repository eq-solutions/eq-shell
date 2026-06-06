#!/usr/bin/env node
// scripts/reconcile-sks-staff-dry-run.mjs
//
// READ-ONLY. Dry-run for decision D-C (cards-field-promotion-sprint): the SKS
// tenant plane (ehowg) holds TWO person stores —
//   - public.sks_staff      : 19 legacy managers (source_table='managers')
//   - app_data.staff         : the canonical staff table Field will read
// The Field-unification end state is a SINGLE person table, so the 19 managers
// must be collapsed into app_data.staff. This script reports how cleanly they
// match (by phone, then email) so Royce can decide what to do with the rest.
// It is the evidence that the collapse is safe; it WRITES NOTHING.
//
// Why a one-time collapse and not a phone-matcher inside cards-approve-staff:
//   once there is one person table, promotion (a state-flip on app_data.staff)
//   can never duplicate by construction. The match only has to happen once,
//   here, as a migration concern — never in the steady-state bridge.
//
// Matching: phone normalised to digits-only; email lower/trimmed. Phone wins;
//   email is the fallback. Anything that matches >1 app_data.staff row is
//   flagged 'ambiguous' for a human, never auto-merged.
//
// Required env vars (the SKS data plane = ehowgjardagevnrluult; pull from
//   shell_control.tenant_routing where tenants.slug='sks', or the project API
//   settings):
//   SKS_SUPABASE_URL          https://ehowgjardagevnrluult.supabase.co
//   SKS_SUPABASE_SERVICE_KEY  service-role key (read-only use here)
//
// Usage:
//   node scripts/reconcile-sks-staff-dry-run.mjs
//   node scripts/reconcile-sks-staff-dry-run.mjs --json   # machine-readable

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: { json: { type: 'boolean', default: false } } });
const env = requireEnvs(['SKS_SUPABASE_URL', 'SKS_SUPABASE_SERVICE_KEY']);

const sb = createClient(env.SKS_SUPABASE_URL, env.SKS_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const normPhone = (v) => (v ?? '').replace(/\D/g, '');
const normEmail = (v) => (v ?? '').trim().toLowerCase();

// Legacy managers (the store being collapsed). public schema.
const { data: managers, error: mErr } = await sb
  .from('sks_staff')
  .select('id, name, phone, email, role, category, archived')
  .or('archived.is.null,archived.eq.false');
if (mErr) { console.error('read sks_staff failed:', mErr.message); process.exit(1); }

// Canonical staff (the survivor). app_data schema.
const { data: staff, error: sErr } = await sb
  .schema('app_data')
  .from('staff')
  .select('staff_id, first_name, last_name, phone, email, active')
  .eq('active', true);
if (sErr) { console.error('read app_data.staff failed:', sErr.message); process.exit(1); }

// Index canonical staff by normalised phone + email (a key can map to many rows).
const byPhone = new Map();
const byEmail = new Map();
const push = (map, key, val) => { if (!key) return; const arr = map.get(key) ?? []; arr.push(val); map.set(key, arr); };
for (const s of staff) {
  push(byPhone, normPhone(s.phone), s);
  push(byEmail, normEmail(s.email), s);
}

const matchedPhone = [], matchedEmail = [], ambiguous = [], unmatched = [];
for (const m of managers) {
  const p = normPhone(m.phone), e = normEmail(m.email);
  const pHits = p ? (byPhone.get(p) ?? []) : [];
  const eHits = e ? (byEmail.get(e) ?? []) : [];

  if (pHits.length === 1) { matchedPhone.push({ m, to: pHits[0], on: 'phone' }); }
  else if (pHits.length > 1) { ambiguous.push({ m, hits: pHits, on: 'phone' }); }
  else if (eHits.length === 1) { matchedEmail.push({ m, to: eHits[0], on: 'email' }); }
  else if (eHits.length > 1) { ambiguous.push({ m, hits: eHits, on: 'email' }); }
  else { unmatched.push({ m }); }
}

const summary = {
  sks_active: managers.length,
  app_data_active: staff.length,
  matched_phone: matchedPhone.length,
  matched_email_only: matchedEmail.length,
  ambiguous: ambiguous.length,
  unmatched: unmatched.length,
};

if (args.json) {
  console.log(JSON.stringify({ summary, matchedPhone, matchedEmail, ambiguous, unmatched }, null, 2));
  process.exit(0);
}

log('SKS staff reconciliation — DRY RUN (no writes)');
console.table(summary);

const nameOf = (s) => `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim();
if (ambiguous.length) {
  log('AMBIGUOUS (matched >1 canonical row — needs a human, never auto-merge):');
  for (const a of ambiguous) console.log(`  - ${a.m.name} (on ${a.on}) -> ${a.hits.map(nameOf).join(' | ')}`);
}
if (unmatched.length) {
  log('UNMATCHED (net-new managers — Royce decides: insert into app_data.staff or leave):');
  for (const u of unmatched) console.log(`  - ${u.m.name}  [${u.m.role ?? '—'}/${u.m.category ?? '—'}]  ${u.m.phone ?? 'no-phone'}  ${u.m.email ?? 'no-email'}`);
}
log(`Collapse would merge ${matchedPhone.length + matchedEmail.length}, flag ${ambiguous.length}, leave ${unmatched.length} net-new. Apply during F2, not here.`);

function requireEnvs(names) {
  const out = {}; const missing = [];
  for (const n of names) { const v = process.env[n]; if (!v) missing.push(n); else out[n] = v; }
  if (missing.length) { console.error(`Missing env: ${missing.join(', ')}`); process.exit(1); }
  return out;
}
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
