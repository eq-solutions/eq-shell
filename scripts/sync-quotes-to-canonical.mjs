#!/usr/bin/env node
// scripts/sync-quotes-to-canonical.mjs
//
// ETL: nspbmirochztcjijmcrx (SKS Flask quotes DB) → ehowgjardagevnrluult (sks-canonical)
//
// What it syncs:
//   1. sks_quotes_customers → app_data.customers (upsert on tenant_id + external_id)
//   2. sks_quotes headers   → app_data.quote     (upsert on quote_id PK)
//   3. sks_quotes JSONB     → app_data.quote_line_item (delete + re-insert per quote)
//   4. Status entry         → app_data.quote_status_history (insert-if-missing)
//   5. canonical_id written back to sks_quotes for stable key across runs
//
// Upsert key for quotes: quote_id (PK).
//   - Quotes with canonical_id already set in Flask → reuse that UUID as quote_id
//   - New quotes → generate UUID, write back to Flask on apply
// This avoids needing a UNIQUE(tenant_id, external_id) constraint.
//
// Safety: double-gated — writes only when --apply AND all four env keys present AND not CI.
//
// Usage:
//   node scripts/sync-quotes-to-canonical.mjs               # dry-run (default)
//   node scripts/sync-quotes-to-canonical.mjs --apply       # WRITE (needs keys)
//   node scripts/sync-quotes-to-canonical.mjs --json        # machine-readable output
//
// Required env vars:
//   NSPBMIR_URL / NSPBMIR_SUPABASE_URL           Flask DB URL (nspbmirochztcjijmcrx)
//   NSPBMIR_SERVICE_KEY / NSPBMIR_SUPABASE_SERVICE_KEY
//   EHOW_URL / EHOW_SUPABASE_URL                 sks-canonical URL (ehowgjardagevnrluult)
//   EHOW_SERVICE_KEY / EHOW_SUPABASE_SERVICE_KEY
//
// Exit codes: 0 = ok; 1 = config error; 2 = read error; 3 = --apply blocked; 4 = write error.

import { createClient } from '@supabase/supabase-js';
import { parseArgs }    from 'node:util';
import { randomUUID }   from 'node:crypto';

// ── constants ─────────────────────────────────────────────────────────────────

const SKS_ORG_ID    = '1eb831f9-aeae-4e57-b49e-9681e8f51e15';
const TENANT_ID     = '7dee117c-98bd-4d39-af8c-2c81d02a1e85';

// Flask title-case → canonical hyphenated EQ Ops lifecycle (0065 schema)
const STATUS_MAP = {
  'Draft':            'draft',
  'Submitted':        'submitted',
  'Client Reviewing': 'submitted',
  'Verbal Win':       'verbal-win',
  'Won-Awaiting Job No': 'won-awaiting-job-no',
  'Won-Job Created':  'won-job-created',
  'Lost':             'lost',
  'On Hold':          'draft',
  'Withdrawn':        'superseded',
};

// JSONB arrays in sks_quotes → canonical line_item category
const LINE_CATS = [
  { field: 'labour',     category: 'labour' },
  { field: 'materials',  category: 'material' },
  { field: 'subcon',     category: 'subcontractor' },
  { field: 'prelims',    category: 'other' },
  { field: 'inclusions', category: 'other' },
];

// ── args ──────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    apply:   { type: 'boolean', default: false },
    json:    { type: 'boolean', default: false },
  },
});

// ── env ───────────────────────────────────────────────────────────────────────

const NSPBMIR_URL = process.env.NSPBMIR_URL || process.env.NSPBMIR_SUPABASE_URL;
const NSPBMIR_KEY = process.env.NSPBMIR_SERVICE_KEY || process.env.NSPBMIR_SUPABASE_SERVICE_KEY;
const EHOW_URL    = process.env.EHOW_URL || process.env.EHOW_SUPABASE_URL;
const EHOW_KEY    = process.env.EHOW_SERVICE_KEY || process.env.EHOW_SUPABASE_SERVICE_KEY;

const haveAllKeys = !!(NSPBMIR_URL && NSPBMIR_KEY && EHOW_URL && EHOW_KEY);
const inCI        = !!process.env.CI;

// ── double gate ───────────────────────────────────────────────────────────────

let APPLY = false;
if (args.apply) {
  if (inCI)         fail(3, '--apply refused in CI.');
  if (!haveAllKeys) fail(3, '--apply requires NSPBMIR_* + EHOW_* env vars. Drop --apply to dry-run.');
  APPLY = true;
}
if (!haveAllKeys) fail(1, 'Missing env vars. Need NSPBMIR_URL/KEY + EHOW_URL/KEY.');

const MODE = APPLY ? 'apply' : 'dry-run';

const source = createClient(NSPBMIR_URL, NSPBMIR_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const target = createClient(EHOW_URL,    EHOW_KEY,    { auth: { persistSession: false, autoRefreshToken: false } });

// ── helpers ───────────────────────────────────────────────────────────────────

function toCents(val)       { return Math.round(parseFloat(val || '0') * 100); }
function toThousandths(val) { return Math.round(parseFloat(val || '1') * 1000); }
function mapStatus(s)       { return STATUS_MAP[s] ?? 'draft'; }
function log(msg)           { if (!args.json) console.error(`[${new Date().toISOString()}] ${msg}`); }
function warn(msg)          { report.warnings.push(msg); if (!args.json) console.warn(`  ⚠  ${msg}`); }
function fail(code, msg)    { console.error(`ERROR: ${msg}`); process.exit(code); }

async function readAll(query, label) {
  const PAGE = 1000;
  const out  = [];
  let from   = 0;
  for (;;) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) fail(2, `read ${label}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += data.length;
  }
  return out;
}

// ── report skeleton ───────────────────────────────────────────────────────────

const report = {
  meta: {
    generated_at: new Date().toISOString(),
    mode: MODE,
    source_db: 'nspbmirochztcjijmcrx',
    target_db: 'ehowgjardagevnrluult (sks-canonical)',
    tenant_id: TENANT_ID,
  },
  customers:      { source: 0, upserted: 0 },
  quotes:         { source: 0, skipped: 0, synced: 0, no_customer: [], no_site: [] },
  line_items:     { total: 0 },
  status_history: { inserted: 0 },
  warnings:       [],
};

// ── 1. customers ──────────────────────────────────────────────────────────────

log('Fetching sks_quotes_customers…');
const custRows = await readAll(
  source.from('sks_quotes_customers').select('id, name').eq('archived', false),
  'sks_quotes_customers',
);
report.customers.source = custRows.length;
log(`  ${custRows.length} quote customers`);

const canonicalCustRows = custRows.map(r => ({
  tenant_id:      TENANT_ID,
  external_id:    r.id,
  type:           'company',
  company_name:   r.name,
  imported_from:  'eq-quotes',
  schema_version: '1.0.0',
}));

let custIdMap = {};
if (APPLY) {
  const { data: upserted, error } = await target
    .schema('app_data')
    .from('customers')
    .upsert(canonicalCustRows, { onConflict: 'tenant_id,external_id', ignoreDuplicates: false })
    .select('customer_id, external_id');
  if (error) fail(4, `upsert customers: ${error.message}`);
  upserted.forEach(r => { custIdMap[r.external_id] = r.customer_id; });
  report.customers.upserted = upserted.length;
  log(`  ${upserted.length} customers upserted`);
} else {
  // dry-run: build a fake map so the rest of the report can run
  custRows.forEach(r => { custIdMap[r.id] = `[would-create-${r.id.slice(0,8)}]`; });
  report.customers.upserted = custRows.length;
}

// ── 2. site index (canonical → name/code lookup) ─────────────────────────────

log('Building site index from sks-canonical…');
const siteRows = await readAll(
  target.schema('app_data').from('sites').select('site_id, name, code').eq('tenant_id', TENANT_ID),
  'canonical sites',
);
const siteByName = {};
const siteByCode = {};
siteRows.forEach(r => {
  if (r.name) siteByName[r.name.toLowerCase().trim()] = r.site_id;
  if (r.code) siteByCode[r.code.toLowerCase().trim()] = r.site_id;
});

function resolveSiteId(siteText) {
  if (!siteText) return null;
  const lower = siteText.toLowerCase().trim();
  if (siteByCode[lower]) return siteByCode[lower];
  if (siteByName[lower]) return siteByName[lower];
  for (const [k, v] of Object.entries(siteByName)) {
    if (lower.includes(k) || k.includes(lower)) return v;
  }
  return null;
}

// ── 3. quotes ─────────────────────────────────────────────────────────────────

log('Fetching sks_quotes…');
const quotes = await readAll(
  source
    .from('sks_quotes')
    .select([
      'id', 'number', 'date', 'status', 'customer_id', 'customer_name',
      'site', 'title', 'project_name', 'scope_of_works',
      'attn_name', 'attn_first_name', 'attn_phone', 'address',
      'estimator_name', 'estimator_initials', 'sent_at', 'sent_by_initials',
      'margin_pct', 'validity_days', 'payment_terms', 'expires_at',
      'workbench_job_no',
      'client_accepted_at', 'client_accepted_by', 'client_declined_at',
      'loss_reason', 'canonical_id', 'created_at', 'updated_at',
      'labour', 'materials', 'subcon', 'prelims', 'inclusions',
    ].join(','))
    .eq('org_id', SKS_ORG_ID)
    .is('deleted_at', null),
  'sks_quotes',
);
report.quotes.source = quotes.length;
log(`  ${quotes.length} live quotes`);

const now = new Date().toISOString();

for (const r of quotes) {
  // customer resolution
  const canonCustomerId = custIdMap[r.customer_id];
  if (!canonCustomerId) {
    warn(`No canonical customer for ${r.number} (flask customer_id ${r.customer_id} — ${r.customer_name}) — skipping`);
    report.quotes.no_customer.push(r.number);
    report.quotes.skipped++;
    continue;
  }

  // site resolution
  const siteId = resolveSiteId(r.site);
  if (r.site && !siteId) {
    warn(`No site match for ${r.number} site="${r.site}" — quote will have null site_id`);
    report.quotes.no_site.push(`${r.number}: ${r.site}`);
  }

  // stable quote_id: use existing canonical_id from Flask if set; else generate
  const quoteId = r.canonical_id ?? randomUUID();

  // compute totals from JSONB line items
  let subtotalCents = 0;
  const lineItems   = [];
  let lineNum       = 1;
  for (const { field, category } of LINE_CATS) {
    for (const item of (r[field] ?? [])) {
      if (!item.description) continue;
      const lineTotalCents = toCents(item.line_total);
      subtotalCents += lineTotalCents;
      lineItems.push({
        tenant_id:            TENANT_ID,
        quote_id:             quoteId,
        line_number:          lineNum++,
        description:          item.description,
        quantity_thousandths: toThousandths(item.qty),
        unit:                 item.unit ?? null,
        unit_rate_cents:      toCents(item.rate),
        line_total_cents:     lineTotalCents,
        category,
        imported_from:        'eq-quotes',
      });
    }
  }
  const gstCents = Math.round(subtotalCents * 0.10);

  const quoteRow = {
    quote_id:             quoteId,
    tenant_id:            TENANT_ID,
    external_id:          String(r.id),
    customer_id:          canonCustomerId,
    site_id:              siteId ?? null,
    quote_number:         r.number ?? null,
    project_name:         r.project_name ?? r.title ?? null,
    attn_name:            r.attn_name ?? null,
    attn_first_name:      r.attn_first_name ?? null,
    attn_phone:           r.attn_phone ?? null,
    address:              r.address ?? null,
    scope_of_works:       r.scope_of_works ?? null,
    estimator_name:       r.estimator_name ?? null,
    estimator_initials:   r.estimator_initials ?? null,
    status:               mapStatus(r.status),
    subtotal_cents:       subtotalCents,
    gst_cents:            gstCents,
    total_cents:          subtotalCents + gstCents,
    margin_pct:           r.margin_pct ?? null,
    sent_at:              r.sent_at ?? null,
    sent_by_initials:     r.sent_by_initials ?? null,
    workbench_job_no:     r.workbench_job_no ?? null,
    validity_days:        r.validity_days ?? 30,
    payment_terms:        r.payment_terms ?? null,
    expires_at:           r.expires_at ?? null,
    client_accepted_at:   r.client_accepted_at ?? null,
    client_accepted_by:   r.client_accepted_by ?? null,
    client_declined_at:   r.client_declined_at ?? null,
    loss_reason:          r.loss_reason ?? null,
    imported_from:        'eq-quotes',
    schema_version:       '1.0.0',
  };

  if (APPLY) {
    // upsert quote on PK (quote_id)
    const { error: qErr } = await target
      .schema('app_data')
      .from('quote')
      .upsert(quoteRow, { onConflict: 'quote_id', ignoreDuplicates: false });
    if (qErr) { warn(`upsert quote ${r.number}: ${qErr.message}`); report.quotes.skipped++; continue; }

    // line items: delete + re-insert (source of truth is Flask JSONB)
    await target.schema('app_data').from('quote_line_item').delete().eq('quote_id', quoteId);
    if (lineItems.length > 0) {
      const { error: liErr } = await target.schema('app_data').from('quote_line_item').insert(lineItems);
      if (liErr) warn(`line items for ${r.number}: ${liErr.message}`);
      else report.line_items.total += lineItems.length;
    }

    // status history: insert one entry if none exists for this quote yet
    const { data: existing } = await target
      .schema('app_data')
      .from('quote_status_history')
      .select('history_id')
      .eq('quote_id', quoteId)
      .limit(1);
    if (!existing?.length) {
      await target.schema('app_data').from('quote_status_history').insert({
        quote_id:     quoteId,
        tenant_id:    TENANT_ID,
        from_status:  null,
        to_status:    mapStatus(r.status),
        changed_at:   r.created_at ?? now,
        changed_by:   r.estimator_initials ?? null,
        note:         'Imported from eq-quotes (sks_quotes)',
      });
      report.status_history.inserted++;
    }

    // write canonical_id back to Flask if it was freshly generated
    if (!r.canonical_id) {
      await source
        .from('sks_quotes')
        .update({ canonical_id: quoteId, canonical_synced_at: now })
        .eq('id', r.id);
    }

    report.quotes.synced++;
  } else {
    // dry-run: just count
    report.quotes.synced++;
    report.line_items.total += lineItems.length;
    report.status_history.inserted += 1;
  }
}

// ── output ────────────────────────────────────────────────────────────────────

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const bar  = '━'.repeat(68);
  const verb = APPLY ? 'upserted' : 'would upsert';
  console.log(bar);
  console.log(APPLY
    ? ' sks_quotes → sks-canonical APPLY (writing ehow app_data)'
    : ' sks_quotes → sks-canonical DRY RUN (no writes)');
  console.log(bar);
  console.log(`  mode              ${MODE}`);
  console.log(`  tenant            ${TENANT_ID}`);
  console.log(`  customers ${verb}  ${report.customers.upserted} / ${report.customers.source}`);
  console.log(`  quotes ${verb}     ${report.quotes.synced} / ${report.quotes.source}`);
  console.log(`  quotes skipped    ${report.quotes.skipped}`);
  console.log(`  line items        ${report.line_items.total}`);
  console.log(`  status history    ${report.status_history.inserted}`);
  if (report.quotes.no_customer.length) {
    console.log(`  ! no customer:    ${report.quotes.no_customer.join(', ')}`);
  }
  if (report.quotes.no_site.length) {
    console.log(`  ! no site match:`);
    report.quotes.no_site.forEach(s => console.log(`      ${s}`));
  }
  if (report.warnings.length) {
    console.log(`  warnings (${report.warnings.length}):`);
    report.warnings.forEach(w => console.log(`    ⚠  ${w}`));
  }
  console.log(bar);
  console.log(APPLY
    ? '  APPLY complete. Re-runs are idempotent (upsert on quote_id PK).'
    : '  DRY RUN — nothing written. Pass --apply with env keys to write.');
  console.log(bar);
}
process.exit(0);
