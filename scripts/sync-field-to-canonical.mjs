#!/usr/bin/env node
// B4: eq-solves-field SKS (nspbmirochztcjijmcrx) → eq-canonical (jvknxcmbtrfnxfrwfimn)
//
// 1. Sync Field sites  → app_data.sites  (imported_from='eq-solves-field')
// 2. Sync Field people → app_data.staff  (with default_site_id resolved)
// 3. Write canonical_id back to source tables
//
// Run idempotently — safe to re-run after data changes.
//
// Usage:
//   node scripts/sync-field-to-canonical.mjs
//
// Required env vars:
//   CANONICAL_SUPABASE_URL         eq-canonical project URL
//   CANONICAL_SUPABASE_SERVICE_KEY eq-canonical service role key
//   FIELD_SUPABASE_URL             eq-solves-field SKS (nspbmirochztcjijmcrx) URL
//   FIELD_SUPABASE_SERVICE_KEY     eq-solves-field SKS service role key
//
// Tenant mapping:
//   Source SKS org:  1eb831f9-aeae-4e57-b49e-9681e8f51e15
//   Canonical SKS:   7dee117c-98bd-4d39-af8c-2c81d02a1e85
//
// Note: Field sites are work-deployment sites; Service sites (from B1) are
// maintenance locations. Both live in app_data.sites, distinguished by
// imported_from='eq-solves-field' vs 'eq-solves-service'.

import { createClient } from '@supabase/supabase-js';

const SOURCE_ORG_ID       = '1eb831f9-aeae-4e57-b49e-9681e8f51e15';
const CANONICAL_TENANT_ID = '7dee117c-98bd-4d39-af8c-2c81d02a1e85';

// Field group values → canonical employment_type
// SKS stores 'SKS Direct' in the DB (normalised to 'Direct' in the UI).
const GROUP_TO_EMPLOYMENT_TYPE = {
  'Direct':      'employee',
  'SKS Direct':  'employee',
  'Labour Hire': 'labour_hire',
  'Apprentice':  'apprentice',
};

const ORDINAL_SUFFIX = ['st', 'nd', 'rd', 'th', 'th'];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing env var: ${name}`); process.exit(1); }
  return v;
}

const canonical = createClient(
  requireEnv('CANONICAL_SUPABASE_URL'),
  requireEnv('CANONICAL_SUPABASE_SERVICE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const field = createClient(
  requireEnv('FIELD_SUPABASE_URL'),
  requireEnv('FIELD_SUPABASE_SERVICE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }

// "Brian Griffin Colls" → { first_name: "Brian", last_name: "Griffin Colls" }
function splitName(fullName) {
  const s = (fullName ?? '').trim();
  const idx = s.indexOf(' ');
  if (idx === -1) return { first_name: s, last_name: s };
  return { first_name: s.slice(0, idx), last_name: s.slice(idx + 1) };
}

function apprenticeLevel(yearLevel) {
  const n = Number(yearLevel);
  if (!n || n < 1 || n > 4) return 'apprentice';
  const suffix = ORDINAL_SUFFIX[n - 1] ?? 'th';
  return `${n}${suffix} year apprentice`;
}

// ── sites ─────────────────────────────────────────────────────────────────────

async function syncSites() {
  log('Fetching Field sites (SKS)…');
  const { data: rows, error } = await field
    .from('sites')
    .select('id, name, abbr, address, site_lead, site_lead_phone, site_lead_email')
    .eq('org_id', SOURCE_ORG_ID)
    .is('deleted_at', null);
  if (error) throw new Error(`fetch Field sites: ${error.message}`);
  log(`  ${rows.length} sites to sync`);

  const canonical_rows = rows.map(r => ({
    tenant_id:          CANONICAL_TENANT_ID,
    external_id:        String(r.id),  // bigint → text
    name:               r.name,
    code:               r.abbr ?? null,
    address_line_1:     r.address ?? null,
    site_contact_name:  r.site_lead ?? null,
    site_contact_phone: r.site_lead_phone ?? null,
    site_contact_email: r.site_lead_email ?? null,
    active:             true,
    track_hours:        false,
    imported_from:      'eq-solves-field',
    schema_version:     '1.0.0',
  }));

  const { data: inserted, error: uErr } = await canonical
    .schema('app_data')
    .from('sites')
    .upsert(canonical_rows, { onConflict: 'tenant_id,external_id', ignoreDuplicates: false })
    .select('site_id, external_id');
  if (uErr) throw new Error(`upsert Field sites: ${uErr.message}`);
  log(`  ${inserted.length} canonical sites upserted`);

  const idMap = {};
  inserted.forEach(r => { idMap[r.external_id] = r.site_id; });

  let updated = 0;
  for (const r of rows) {
    const cid = idMap[String(r.id)];
    if (!cid) { warn(`No canonical_id for Field site ${r.id} (${r.name})`); continue; }
    const { error: upErr } = await field
      .from('sites')
      .update({ canonical_id: cid, canonical_synced_at: new Date().toISOString() })
      .eq('id', r.id);
    if (upErr) warn(`Back-write Field site ${r.id}: ${upErr.message}`);
    else updated++;
  }
  log(`  ${updated} Field sites updated with canonical_id`);
  return idMap;
}

// ── people → staff ────────────────────────────────────────────────────────────

async function syncPeople(siteIdMap) {
  log('Fetching Field people (SKS)…');
  const { data: rows, error } = await field
    .from('people')
    .select('id, name, "group", licence, agency, phone, email, start_date, year_level, tafe_day, dob_day, dob_month')
    .eq('org_id', SOURCE_ORG_ID)
    .is('deleted_at', null)
    .eq('archived', false);
  if (error) throw new Error(`fetch Field people: ${error.message}`);
  log(`  ${rows.length} people to sync`);

  const canonical_rows = rows.map(r => {
    const { first_name, last_name } = splitName(r.name);
    const rawGroup = r.group ?? '';
    const employment_type = GROUP_TO_EMPLOYMENT_TYPE[rawGroup] ?? 'employee';

    let level = null;
    if (employment_type === 'apprentice' && r.year_level) {
      level = apprenticeLevel(r.year_level);
    } else if (r.licence === 'Licensed') {
      level = 'tradesperson';
    }

    return {
      tenant_id:       CANONICAL_TENANT_ID,
      external_id:     String(r.id),  // bigint → text
      first_name,
      last_name,
      email:           r.email ?? null,
      phone:           r.phone ?? null,
      employment_type,
      trade:           'electrical',
      level,
      start_date:      r.start_date ?? null,
      tafe_day:        r.tafe_day ?? null,
      dob_day:         r.dob_day ?? null,
      dob_month:       r.dob_month ?? null,
      year_level:      r.year_level ?? null,
      active:          true,
      notify_roster:   false,
      digest_opt_in:   false,
      imported_from:   'eq-solves-field',
      schema_version:  '1.0.0',
    };
  });

  const CHUNK = 200;
  const idMap = {};
  for (let i = 0; i < canonical_rows.length; i += CHUNK) {
    const chunk = canonical_rows.slice(i, i + CHUNK);
    const { data: inserted, error: uErr } = await canonical
      .schema('app_data')
      .from('staff')
      .upsert(chunk, { onConflict: 'tenant_id,external_id', ignoreDuplicates: false })
      .select('staff_id, external_id');
    if (uErr) throw new Error(`upsert staff batch ${Math.floor(i / CHUNK) + 1}: ${uErr.message}`);
    inserted.forEach(r => { idMap[r.external_id] = r.staff_id; });
    log(`  staff batch ${Math.floor(i / CHUNK) + 1}: ${inserted.length} upserted`);
  }

  let updated = 0;
  for (const r of rows) {
    const cid = idMap[String(r.id)];
    if (!cid) { warn(`No canonical_id for person ${r.id} (${r.name})`); continue; }
    const { error: upErr } = await field
      .from('people')
      .update({ canonical_id: cid, canonical_synced_at: new Date().toISOString() })
      .eq('id', r.id);
    if (upErr) warn(`Back-write person ${r.id}: ${upErr.message}`);
    else updated++;
  }
  log(`  ${updated} Field people updated with canonical_id`);
}

// ── main ──────────────────────────────────────────────────────────────────────

(async () => {
  log('=== Field → canonical sync start ===');
  try {
    const siteIdMap = await syncSites();
    await syncPeople(siteIdMap);
    log('=== Sync complete ===');
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  }
})();
