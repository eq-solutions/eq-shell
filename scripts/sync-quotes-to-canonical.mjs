#!/usr/bin/env node
// eq-quotes (nspbmirochztcjijmcrx) → sks-canonical (ehowgjardagevnrluult)
//
// 1. Sync sks_quotes_customers → app_data.customers
// 2. Sync sks_quotes headers + line items → app_data.quote + app_data.quote_line_item
// 3. Write canonical_id back to sks_quotes
//
// Run idempotently — safe to re-run after data changes.
//
// Usage:
//   NSPBMIR_SUPABASE_URL=... NSPBMIR_SERVICE_KEY=... EHOW_SERVICE_KEY=... node scripts/sync-quotes-to-canonical.mjs
//
// Required env vars:
//   NSPBMIR_SUPABASE_URL      eq-quotes (nspbmirochztcjijmcrx) URL
//   NSPBMIR_SERVICE_KEY       eq-quotes service role key
//   EHOW_SERVICE_KEY          sks-canonical (ehowgjardagevnrluult) service role key
//
// Tenant mapping:
//   Source SKS org:   1eb831f9-aeae-4e57-b49e-9681e8f51e15  (sks_quotes.org_id)
//   Canonical SKS:    7dee117c-98bd-4d39-af8c-2c81d02a1e85  (sks-canonical tenant)

import { createClient } from '@supabase/supabase-js';

const SOURCE_ORG_ID       = '1eb831f9-aeae-4e57-b49e-9681e8f51e15';
const CANONICAL_TENANT_ID = '7dee117c-98bd-4d39-af8c-2c81d02a1e85';

const STATUS_MAP = {
  'Draft':               'draft',
  'Submitted':           'submitted',
  'Client Reviewing':    'submitted',
  'Verbal Win':          'verbal-win',
  'Won-Awaiting Job No': 'won-awaiting-job-no',
  'Won-Job Created':     'won-job-created',
  'Lost':                'lost',
  'On Hold':             'draft',
  'Withdrawn':           'superseded',
};

// JSONB category fields in sks_quotes → canonical line item category
const LINE_CATS = [
  { field: 'labour',     category: 'labour' },
  { field: 'materials',  category: 'material' },
  { field: 'subcon',     category: 'subcontractor' },
  { field: 'prelims',    category: 'other' },
  { field: 'inclusions', category: 'other' },
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing env var: ${name}`); process.exit(1); }
  return v;
}

const canonical = createClient(
  'https://ehowgjardagevnrluult.supabase.co',
  requireEnv('EHOW_SERVICE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const source = createClient(
  requireEnv('NSPBMIR_SUPABASE_URL'),
  requireEnv('NSPBMIR_SERVICE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }

function toCents(val)          { return Math.round(parseFloat(val || '0') * 100); }
function toThousandths(val)    { return Math.round(parseFloat(val || '1') * 1000); }
function mapStatus(s)          { return STATUS_MAP[s] ?? 'draft'; }

// ── customers ─────────────────────────────────────────────────────────────────

async function syncCustomers() {
  log('Fetching sks_quotes_customers…');
  const { data: rows, error } = await source
    .from('sks_quotes_customers')
    .select('id, name')
    .eq('archived', false);
  if (error) throw new Error(`fetch customers: ${error.message}`);
  log(`  ${rows.length} quote customers to sync`);

  const canonical_rows = rows.map(r => ({
    tenant_id:      CANONICAL_TENANT_ID,
    external_id:    r.id,
    type:           'company',
    company_name:   r.name,
    imported_from:  'eq-quotes',
    schema_version: '1.0.0',
  }));

  const { data: inserted, error: uErr } = await canonical
    .schema('app_data')
    .from('customers')
    .upsert(canonical_rows, { onConflict: 'tenant_id,external_id', ignoreDuplicates: false })
    .select('customer_id, external_id');
  if (uErr) throw new Error(`upsert customers: ${uErr.message}`);
  log(`  ${inserted.length} canonical customers upserted`);

  const idMap = {};
  inserted.forEach(r => { idMap[r.external_id] = r.customer_id; });
  return idMap;
}

// ── sites lookup ──────────────────────────────────────────────────────────────

async function loadCanonicalSites() {
  const { data: rows, error } = await canonical
    .schema('app_data')
    .from('sites')
    .select('site_id, name, code')
    .eq('tenant_id', CANONICAL_TENANT_ID);
  if (error) throw new Error(`fetch canonical sites: ${error.message}`);

  const byName = {};
  const byCode = {};
  rows.forEach(r => {
    if (r.name) byName[r.name.toLowerCase().trim()] = r.site_id;
    if (r.code) byCode[r.code.toLowerCase().trim()] = r.site_id;
  });
  return { byName, byCode };
}

function resolveSiteId(siteText, idx) {
  if (!siteText) return null;
  const lower = siteText.toLowerCase().trim();
  if (idx.byCode[lower]) return idx.byCode[lower];
  if (idx.byName[lower]) return idx.byName[lower];
  // partial match: canonical site name is a substring of the quote site text
  for (const [k, v] of Object.entries(idx.byName)) {
    if (lower.includes(k)) return v;
  }
  return null;
}

// ── line items ────────────────────────────────────────────────────────────────

function buildLineItems(quote, quoteId) {
  const items = [];
  let lineNum = 1;
  let subtotal = 0;

  for (const { field, category } of LINE_CATS) {
    for (const item of (quote[field] ?? [])) {
      if (!item.description) continue;
      const lineTotal = toCents(item.line_total);
      subtotal += lineTotal;
      items.push({
        tenant_id:            CANONICAL_TENANT_ID,
        quote_id:             quoteId,
        line_number:          lineNum++,
        description:          item.description,
        quantity_thousandths: toThousandths(item.qty),
        unit:                 item.unit ?? null,
        unit_rate_cents:      toCents(item.rate),
        line_total_cents:     lineTotal,
        category,
        imported_from:        'eq-quotes',
      });
    }
  }
  return { items, subtotal };
}

// ── quotes ────────────────────────────────────────────────────────────────────

async function syncQuotes(customerIdMap, siteIndex) {
  log('Fetching sks_quotes…');
  const { data: rows, error } = await source
    .from('sks_quotes')
    .select([
      'id', 'number', 'status', 'customer_id', 'site', 'project_name',
      'attn_name', 'attn_first_name', 'attn_phone', 'address', 'scope_of_works',
      'estimator_name', 'estimator_initials', 'margin_pct', 'sent_at',
      'sent_by_initials', 'labour', 'materials', 'subcon', 'prelims', 'inclusions',
    ].join(','))
    .eq('org_id', SOURCE_ORG_ID)
    .is('deleted_at', null);
  if (error) throw new Error(`fetch quotes: ${error.message}`);
  log(`  ${rows.length} quotes to sync`);

  let synced = 0;
  let lineItemsTotal = 0;

  for (const r of rows) {
    const canonicalCustomerId = customerIdMap[r.customer_id];
    if (!canonicalCustomerId) {
      warn(`No canonical customer for quote ${r.number} (source customer_id: ${r.customer_id}) — skipping`);
      continue;
    }

    const siteId = resolveSiteId(r.site, siteIndex);
    if (r.site && !siteId) warn(`No canonical site match for quote ${r.number} site="${r.site}"`);

    // Pre-compute totals from line items
    const { items, subtotal } = buildLineItems(r, null /* placeholder */);
    const gst = Math.round(subtotal * 0.10);

    const quoteRow = {
      tenant_id:          CANONICAL_TENANT_ID,
      external_id:        r.id,
      customer_id:        canonicalCustomerId,
      site_id:            siteId ?? null,
      quote_number:       r.number ?? null,
      project_name:       r.project_name ?? null,
      attn_name:          r.attn_name ?? null,
      attn_first_name:    r.attn_first_name ?? null,
      attn_phone:         r.attn_phone ?? null,
      address:            r.address ?? null,
      scope_of_works:     r.scope_of_works ?? null,
      estimator_name:     r.estimator_name ?? null,
      estimator_initials: r.estimator_initials ?? null,
      status:             mapStatus(r.status),
      subtotal_cents:     subtotal,
      gst_cents:          gst,
      total_cents:        subtotal + gst,
      margin_pct:         r.margin_pct ?? null,
      sent_at:            r.sent_at ?? null,
      sent_by_initials:   r.sent_by_initials ?? null,
      imported_from:      'eq-quotes',
      schema_version:     '1.0.0',
    };

    const { data: upserted, error: uErr } = await canonical
      .schema('app_data')
      .from('quote')
      .upsert(quoteRow, { onConflict: 'tenant_id,external_id', ignoreDuplicates: false })
      .select('quote_id')
      .single();
    if (uErr) { warn(`upsert quote ${r.number}: ${uErr.message}`); continue; }

    // Line items: delete + re-insert to keep in sync with source JSONB
    await canonical
      .schema('app_data')
      .from('quote_line_item')
      .delete()
      .eq('quote_id', upserted.quote_id);

    if (items.length > 0) {
      const lineRows = items.map(li => ({ ...li, quote_id: upserted.quote_id }));
      const { error: liErr } = await canonical
        .schema('app_data')
        .from('quote_line_item')
        .insert(lineRows);
      if (liErr) warn(`line items for ${r.number}: ${liErr.message}`);
      else lineItemsTotal += lineRows.length;
    }

    await source
      .from('sks_quotes')
      .update({ canonical_id: upserted.quote_id, canonical_synced_at: new Date().toISOString() })
      .eq('id', r.id);
    synced++;
  }

  log(`  ${synced} quotes synced, ${lineItemsTotal} line items`);
}

// ── main ──────────────────────────────────────────────────────────────────────

(async () => {
  log('=== Quotes → canonical sync start ===');
  try {
    const customerIdMap = await syncCustomers();
    const siteIndex = await loadCanonicalSites();
    await syncQuotes(customerIdMap, siteIndex);
    log('=== Sync complete ===');
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  }
})();
