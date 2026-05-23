#!/usr/bin/env node
// One-shot migration: eq-solves-service-dev → eq-canonical (app_data)
//
// Reads SKS customers, sites, and assets from the Service Supabase project,
// upserts them into canonical app_data, then writes canonical_id back to
// Service so Service rows know their canonical twin.
//
// Run once after initial deploy, or re-run idempotently after bulk data changes.
//
// Usage:
//   node scripts/sync-service-to-canonical.mjs
//
// Required env vars:
//   CANONICAL_SUPABASE_URL          eq-canonical project URL
//   CANONICAL_SUPABASE_SERVICE_KEY  eq-canonical service role key
//   SERVICE_SUPABASE_URL            eq-solves-service-dev URL
//   SERVICE_SUPABASE_SERVICE_KEY    eq-solves-service-dev service role key
//
// Tenant mapping (hardcoded — update if tenants change):
//   Service SKS tenant:    ccca00fc-cbc8-442e-9489-0f1f216ddca8
//   Canonical SKS tenant:  7dee117c-98bd-4d39-af8c-2c81d02a1e85

import { createClient } from '@supabase/supabase-js';

const SERVICE_TENANT_ID  = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8';
const CANONICAL_TENANT_ID = '7dee117c-98bd-4d39-af8c-2c81d02a1e85';

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
const service = createClient(
  requireEnv('SERVICE_SUPABASE_URL'),
  requireEnv('SERVICE_SUPABASE_SERVICE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// ── helpers ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }

async function upsertBatch(client, schema, table, rows, conflictColumns) {
  if (rows.length === 0) return [];
  const { data, error } = await client
    .schema(schema)
    .from(table)
    .upsert(rows, { onConflict: conflictColumns, ignoreDuplicates: false })
    .select();
  if (error) throw new Error(`upsert ${schema}.${table}: ${error.message}`);
  return data ?? [];
}

// ── customers ────────────────────────────────────────────────────────────────

async function syncCustomers() {
  log('Fetching Service customers…');
  const { data: rows, error } = await service
    .from('customers')
    .select('id,name,email,phone,address,is_active,customer_entity_abn,customer_entity_acn')
    .eq('tenant_id', SERVICE_TENANT_ID)
    .is('deleted_at', null);
  if (error) throw new Error(`fetch customers: ${error.message}`);
  log(`  ${rows.length} customers to sync`);

  const canonical_rows = rows.map(r => ({
    tenant_id:     CANONICAL_TENANT_ID,
    external_id:   r.id,
    type:          'company',
    company_name:  r.name,
    email:         r.email ?? null,
    primary_phone: r.phone ?? null,
    street_address: r.address ?? null,
    abn:           r.customer_entity_abn ?? null,
    acn:           r.customer_entity_acn ?? null,
    active:        r.is_active,
    imported_from: 'eq-solves-service',
    schema_version: '1.0.0',
  }));

  const inserted = await upsertBatch(canonical, 'app_data', 'customers', canonical_rows, 'tenant_id,external_id');
  log(`  ${inserted.length} canonical customers upserted`);

  // Build external_id → canonical_id map
  const idMap = {};
  inserted.forEach(r => { idMap[r.external_id] = r.customer_id; });

  // Write canonical_id back to Service
  let updated = 0;
  for (const r of rows) {
    const cid = idMap[r.id];
    if (!cid) { warn(`No canonical_id for customer ${r.id} (${r.name})`); continue; }
    const { error: upErr } = await service
      .from('customers')
      .update({ canonical_id: cid, canonical_synced_at: new Date().toISOString() })
      .eq('id', r.id);
    if (upErr) warn(`Back-write customer ${r.id}: ${upErr.message}`);
    else updated++;
  }
  log(`  ${updated} Service customers updated with canonical_id`);
  return idMap;
}

// ── sites ─────────────────────────────────────────────────────────────────────

async function syncSites(customerIdMap) {
  log('Fetching Service sites…');
  const { data: rows, error } = await service
    .from('sites')
    .select('id,customer_id,name,code,address,city,state,postcode,country,latitude,longitude,is_active,safety_notes')
    .eq('tenant_id', SERVICE_TENANT_ID)
    .is('deleted_at', null);
  if (error) throw new Error(`fetch sites: ${error.message}`);
  log(`  ${rows.length} sites to sync`);

  const canonical_rows = rows.map(r => ({
    tenant_id:     CANONICAL_TENANT_ID,
    external_id:   r.id,
    customer_id:   r.customer_id ? (customerIdMap[r.customer_id] ?? null) : null,
    name:          r.name,
    code:          r.code ?? null,
    address_line_1: r.address ?? null,
    suburb:        r.city ?? null,
    state:         r.state ?? null,
    postcode:      r.postcode ?? null,
    country:       r.country ?? 'AU',
    latitude:      r.latitude ?? null,
    longitude:     r.longitude ?? null,
    active:        r.is_active,
    notes:         r.safety_notes ?? null,
    imported_from: 'eq-solves-service',
    schema_version: '1.0.0',
  }));

  const inserted = await upsertBatch(canonical, 'app_data', 'sites', canonical_rows, 'tenant_id,external_id');
  log(`  ${inserted.length} canonical sites upserted`);

  const idMap = {};
  inserted.forEach(r => { idMap[r.external_id] = r.site_id; });

  let updated = 0;
  for (const r of rows) {
    const cid = idMap[r.id];
    if (!cid) { warn(`No canonical_id for site ${r.id} (${r.name})`); continue; }
    const { error: upErr } = await service
      .from('sites')
      .update({ canonical_id: cid, canonical_synced_at: new Date().toISOString() })
      .eq('id', r.id);
    if (upErr) warn(`Back-write site ${r.id}: ${upErr.message}`);
    else updated++;
  }
  log(`  ${updated} Service sites updated with canonical_id`);
  return idMap;
}

// ── assets ────────────────────────────────────────────────────────────────────

async function syncAssets(siteIdMap) {
  log('Fetching Service assets…');
  const { data: rows, error } = await service
    .from('assets')
    .select('id,site_id,parent_id,name,asset_type,manufacturer,model,serial_number,install_date,location,building,block_or_zone,is_active,maximo_id,jemena_asset_id')
    .eq('tenant_id', SERVICE_TENANT_ID)
    .is('deleted_at', null);
  if (error) throw new Error(`fetch assets: ${error.message}`);
  log(`  ${rows.length} assets to sync`);

  // Pass 1: insert without parent_asset_id (resolve FKs first)
  const canonical_rows = rows.map(r => {
    const locationParts = [r.building, r.block_or_zone, r.location].filter(Boolean);
    return {
      tenant_id:       CANONICAL_TENANT_ID,
      external_id:     r.id,
      site_id:         r.site_id ? (siteIdMap[r.site_id] ?? null) : null,
      name:            r.name,
      asset_type:      r.asset_type,
      make:            r.manufacturer ?? null,
      model:           r.model ?? null,
      serial_number:   r.serial_number ?? null,
      install_date:    r.install_date ?? null,
      location_in_site: locationParts.length > 0 ? locationParts.join(' / ') : null,
      active:          r.is_active,
      imported_from:   'eq-solves-service',
      schema_version:  '1.0.0',
    };
  });

  // Batch in chunks of 500 to avoid payload limits
  const CHUNK = 500;
  const idMap = {};
  for (let i = 0; i < canonical_rows.length; i += CHUNK) {
    const chunk = canonical_rows.slice(i, i + CHUNK);
    const inserted = await upsertBatch(canonical, 'app_data', 'assets', chunk, 'tenant_id,external_id');
    inserted.forEach(r => { idMap[r.external_id] = r.asset_id; });
    log(`  assets batch ${Math.floor(i / CHUNK) + 1}: ${inserted.length} upserted`);
  }

  // Pass 2: update parent_asset_id now that all assets have canonical ids
  let parentUpdated = 0;
  for (const r of rows) {
    if (!r.parent_id) continue;
    const canonicalParentId = idMap[r.parent_id];
    const canonicalAssetId  = idMap[r.id];
    if (!canonicalParentId || !canonicalAssetId) continue;
    const { error: pErr } = await canonical
      .schema('app_data')
      .from('assets')
      .update({ parent_asset_id: canonicalParentId })
      .eq('asset_id', canonicalAssetId);
    if (pErr) warn(`parent update asset ${r.id}: ${pErr.message}`);
    else parentUpdated++;
  }
  if (parentUpdated > 0) log(`  ${parentUpdated} asset parent_asset_id links resolved`);

  // Write canonical_id back to Service (batch)
  let updated = 0;
  for (const r of rows) {
    const cid = idMap[r.id];
    if (!cid) { warn(`No canonical_id for asset ${r.id} (${r.name})`); continue; }
    const { error: upErr } = await service
      .from('assets')
      .update({ canonical_id: cid, canonical_synced_at: new Date().toISOString() })
      .eq('id', r.id);
    if (upErr) warn(`Back-write asset ${r.id}: ${upErr.message}`);
    else updated++;
  }
  log(`  ${updated} Service assets updated with canonical_id`);
}

// ── main ──────────────────────────────────────────────────────────────────────

(async () => {
  log('=== Service → canonical sync start ===');
  try {
    const customerIdMap = await syncCustomers();
    const siteIdMap     = await syncSites(customerIdMap);
    await syncAssets(siteIdMap);
    log('=== Sync complete ===');
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  }
})();
