// @ts-nocheck
// netlify/functions/sync-quotes-nightly.ts
//
// ETL: sks-quotes (nspbmirochztcjijmcrx) → sks-canonical (ehowgjardagevnrluult)
//
// Runs every 4 hours. Also callable manually via POST to /.netlify/functions/sync-quotes-nightly.
// Idempotent — safe to re-run at any time.
//
// Sync rules:
//   - Flask wins on: status, financials, line items, core metadata
//   - EQ Ops wins on: po_number, workbench_job_no (take non-null; EQ Ops value kept if set)
//   - follow_up_at is never touched (EQ Ops only)
//   - A quote is "Flask newer" when Flask updated_at > EQ Ops imported_at
//   - Quotes with no EQ Ops imported_at are always synced (new or previously untracked)
//   - Soft-deletes in Flask (deleted_at set) are mirrored to EQ Ops
//
// Required Netlify env vars:
//   NSPBMIR_SUPABASE_URL    https://nspbmirochztcjijmcrx.supabase.co
//   NSPBMIR_SERVICE_KEY     service_role key for nspbmirochztcjijmcrx
//   CANONICAL_SUPABASE_URL  https://ehowgjardagevnrluult.supabase.co
//   EHOW_SERVICE_KEY        service_role key for ehowgjardagevnrluult

import type { Config } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

export const config: Config = {
  schedule: '0 */4 * * *', // every 4 hours
};

const SKS_ORG_ID = '1eb831f9-aeae-4e57-b49e-9681e8f51e15';
const TENANT_ID  = '7dee117c-98bd-4d39-af8c-2c81d02a1e85';

// Matches taxonomy.ts FLASK_STATUS_TO_EQ exactly.
const STATUS_MAP: Record<string, string> = {
  'Draft':               'draft',
  'Submitted':           'submitted',
  'Sent':                'submitted',
  'Client Reviewing':    'client-reviewing',
  'Verbal Win':          'verbal-win',
  'Won-Awaiting Job No': 'won-awaiting-job-no',
  'Won-Job Created':     'won-job-created',
  'Lost':                'lost',
  'On Hold':             'on-hold',
  'Withdrawn':           'cancelled',
};

const LINE_CATS = [
  { field: 'labour',     category: 'labour' },
  { field: 'materials',  category: 'material' },
  { field: 'subcon',     category: 'subcontractor' },
  { field: 'prelims',    category: 'other' },
  { field: 'inclusions', category: 'other' },
] as const;

function toCents(val: string | null | undefined): number {
  return Math.round(parseFloat(val ?? '0') * 100);
}

function toThousandths(val: string | null | undefined): number {
  return Math.round(parseFloat(val ?? '1') * 1000);
}

export default async function handler(): Promise<Response> {
  const nspbmirUrl = process.env.NSPBMIR_SUPABASE_URL;
  const nspbmirKey = process.env.NSPBMIR_SERVICE_KEY;
  const ehowUrl    = process.env.CANONICAL_SUPABASE_URL;
  const ehowKey    = process.env.EHOW_SERVICE_KEY;

  if (!nspbmirUrl || !nspbmirKey || !ehowUrl || !ehowKey) {
    const missing = [
      !nspbmirUrl && 'NSPBMIR_SUPABASE_URL',
      !nspbmirKey && 'NSPBMIR_SERVICE_KEY',
      !ehowUrl    && 'CANONICAL_SUPABASE_URL',
      !ehowKey    && 'EHOW_SERVICE_KEY',
    ].filter(Boolean);
    console.error('[sync-quotes-nightly] missing env vars', missing);
    return new Response(JSON.stringify({ ok: false, missing }), { status: 500 });
  }

  const flask = createClient(nspbmirUrl, nspbmirKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ops = createClient(ehowUrl, ehowKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = { customers: 0, inserted: 0, updated: 0, skipped: 0, lineItems: 0, errors: 0 };

  try {
    // ── Step 1: Sync customers ────────────────────────────────────────────────
    const { data: customers, error: custErr } = await flask
      .from('sks_quotes_customers')
      .select('id, name')
      .eq('archived', false);
    if (custErr) throw new Error(`fetch customers: ${custErr.message}`);

    const { data: upsertedCusts, error: uCustErr } = await ops
      .schema('app_data')
      .from('customers')
      .upsert(
        customers!.map(r => ({
          tenant_id:      TENANT_ID,
          external_id:    r.id,
          type:           'company',
          company_name:   r.name,
          imported_from:  'eq-quotes',
          schema_version: '1.0.0',
        })),
        { onConflict: 'tenant_id,external_id', ignoreDuplicates: false }
      )
      .select('customer_id, external_id');
    if (uCustErr) throw new Error(`upsert customers: ${uCustErr.message}`);

    const custIdMap: Record<string, string> = {};
    (upsertedCusts ?? []).forEach(r => { custIdMap[r.external_id] = r.customer_id; });
    result.customers = upsertedCusts?.length ?? 0;

    // ── Step 2: Load canonical sites for matching ─────────────────────────────
    const { data: sites, error: sitesErr } = await ops
      .schema('app_data')
      .from('sites')
      .select('site_id, name, code')
      .eq('tenant_id', TENANT_ID);
    if (sitesErr) throw new Error(`fetch sites: ${sitesErr.message}`);

    const siteByCode: Record<string, string> = {};
    const siteByName: Record<string, string> = {};
    (sites ?? []).forEach(s => {
      if (s.code) siteByCode[s.code.toLowerCase().trim()] = s.site_id;
      if (s.name) siteByName[s.name.toLowerCase().trim()] = s.site_id;
    });

    function resolveSiteId(siteText: string | null): string | null {
      if (!siteText) return null;
      const lower = siteText.toLowerCase().trim();
      if (siteByCode[lower]) return siteByCode[lower];
      if (siteByName[lower]) return siteByName[lower];
      for (const [k, v] of Object.entries(siteByName)) {
        if (lower.includes(k) || k.includes(lower)) return v;
      }
      return null;
    }

    // ── Step 3: Fetch all Flask quotes ────────────────────────────────────────
    const { data: flaskQuotes, error: quotesErr } = await flask
      .from('sks_quotes')
      .select([
        'id', 'number', 'status', 'customer_id', 'site', 'project_name',
        'attn_name', 'attn_first_name', 'attn_phone', 'address', 'scope_of_works',
        'estimator_name', 'estimator_initials', 'margin_pct',
        'sent_at', 'sent_by_initials', 'validity_days', 'payment_terms', 'expires_at',
        'workbench_job_no', 'po_number', 'coupa_entity',
        'client_accepted_at', 'client_accepted_by',
        'client_declined_at', 'loss_reason',
        'canonical_id', 'created_at', 'updated_at', 'deleted_at',
        'labour', 'materials', 'subcon', 'prelims', 'inclusions',
      ].join(','))
      .eq('org_id', SKS_ORG_ID);
    if (quotesErr) throw new Error(`fetch Flask quotes: ${quotesErr.message}`);

    // ── Step 4: Fetch existing EQ Ops quote metadata for comparison ───────────
    const flaskIds = (flaskQuotes ?? []).map(q => q.id);
    const { data: existingOps } = await ops
      .schema('app_data')
      .from('quote')
      .select('quote_id, external_id, imported_at, po_number, workbench_job_no')
      .eq('tenant_id', TENANT_ID)
      .in('external_id', flaskIds);

    const opsMap: Record<string, {
      quote_id: string;
      imported_at: string | null;
      po_number: string | null;
      workbench_job_no: string | null;
    }> = {};
    (existingOps ?? []).forEach(r => { opsMap[r.external_id] = r; });

    // ── Step 5: Upsert each quote ─────────────────────────────────────────────
    const now = new Date().toISOString();

    for (const q of flaskQuotes ?? []) {
      const canonicalCustomerId = custIdMap[q.customer_id];
      if (!canonicalCustomerId) {
        console.warn(`[sync-quotes-nightly] no canonical customer for ${q.number} (Flask customer ${q.customer_id})`);
        result.errors++;
        continue;
      }

      const existing = opsMap[q.id];
      const isNew    = !existing;

      // Only re-sync if Flask has changed since our last import stamp.
      // imported_at = null means we've never tracked this quote properly — always sync.
      const flaskTs    = q.updated_at ? new Date(q.updated_at).getTime() : 0;
      const importedTs = existing?.imported_at ? new Date(existing.imported_at).getTime() : 0;
      const flaskNewer = flaskTs > importedTs;

      if (!isNew && !flaskNewer) {
        result.skipped++;
        continue;
      }

      // EQ Ops wins when it already has a value; Flask fills in if EQ Ops is empty.
      const jobNo   = existing?.workbench_job_no ?? q.workbench_job_no ?? null;
      const poNum   = existing?.po_number        ?? q.po_number        ?? null;

      // Build line items and recalculate totals from Flask JSONB arrays.
      let subtotal = 0;
      const lineItems: object[] = [];
      let lineNum = 1;

      for (const { field, category } of LINE_CATS) {
        for (const item of (q[field] ?? []) as Array<{ description?: string; qty?: string; rate?: string; line_total?: string; unit?: string }>) {
          if (!item.description) continue;
          const lineTotal = toCents(item.line_total);
          subtotal += lineTotal;
          lineItems.push({
            tenant_id:            TENANT_ID,
            line_number:          lineNum++,
            description:          item.description,
            quantity_thousandths: toThousandths(item.qty),
            unit:                 item.unit ?? null,
            unit_rate_cents:      toCents(item.rate),
            line_total_cents:     lineTotal,
            category,
            imported_from:        'eq-quotes',
            schema_version:       '1.0.0',
          });
        }
      }

      const gst   = Math.round(subtotal * 0.1);
      const total = subtotal + gst;

      const quoteRow: Record<string, unknown> = {
        tenant_id:          TENANT_ID,
        external_id:        q.id,
        customer_id:        canonicalCustomerId,
        site_id:            resolveSiteId(q.site),
        quote_number:       q.number ?? null,
        project_name:       q.project_name ?? null,
        attn_name:          q.attn_name ?? null,
        attn_first_name:    q.attn_first_name ?? null,
        attn_phone:         q.attn_phone ?? null,
        address:            q.address ?? null,
        scope_of_works:     q.scope_of_works ?? null,
        estimator_name:     q.estimator_name ?? null,
        estimator_initials: q.estimator_initials ?? null,
        status:             STATUS_MAP[q.status] ?? 'draft',
        subtotal_cents:     subtotal,
        gst_cents:          gst,
        total_cents:        total,
        margin_pct:         q.margin_pct ?? null,
        sent_at:            q.sent_at ?? null,
        sent_by_initials:   q.sent_by_initials ?? null,
        validity_days:      q.validity_days ?? 30,
        payment_terms:      q.payment_terms ?? null,
        expires_at:         q.expires_at ?? null,
        workbench_job_no:   jobNo,
        po_number:          poNum,
        coupa_entity:       q.coupa_entity ?? null,
        client_accepted_at: q.client_accepted_at ?? null,
        client_accepted_by: q.client_accepted_by ?? null,
        client_declined_at: q.client_declined_at ?? null,
        loss_reason:        q.loss_reason ?? null,
        deleted_at:         q.deleted_at ?? null,
        imported_from:      'eq-quotes',
        schema_version:     '1.0.0',
        imported_at:        now,
        // follow_up_at intentionally omitted — EQ Ops only, never sourced from Flask
      };

      // Preserve the canonical quote_id for existing rows so the PK doesn't change.
      if (existing?.quote_id) quoteRow.quote_id = existing.quote_id;
      // Preserve original created_at on insert.
      if (isNew && q.created_at) quoteRow.created_at = q.created_at;

      const { data: upserted, error: uQuoteErr } = await ops
        .schema('app_data')
        .from('quote')
        .upsert(quoteRow, { onConflict: 'tenant_id,external_id', ignoreDuplicates: false })
        .select('quote_id')
        .single();

      if (uQuoteErr || !upserted) {
        console.error(`[sync-quotes-nightly] upsert ${q.number}:`, uQuoteErr?.message);
        result.errors++;
        continue;
      }

      // Write canonical_id back to Flask so it knows this quote's EQ Ops UUID.
      if (!q.canonical_id) {
        await flask
          .from('sks_quotes')
          .update({ canonical_id: upserted.quote_id })
          .eq('id', q.id);
      }

      // Replace line items (Flask is authoritative on line item content).
      await ops
        .schema('app_data')
        .from('quote_line_item')
        .delete()
        .eq('quote_id', upserted.quote_id);

      if (lineItems.length > 0) {
        const rows = lineItems.map(li => ({ ...li, quote_id: upserted.quote_id }));
        const { error: liErr } = await ops
          .schema('app_data')
          .from('quote_line_item')
          .insert(rows);
        if (liErr) {
          console.warn(`[sync-quotes-nightly] line items ${q.number}:`, liErr.message);
        } else {
          result.lineItems += rows.length;
        }
      }

      if (isNew) result.inserted++;
      else result.updated++;
    }

    console.info('[sync-quotes-nightly] complete', result);
    return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });

  } catch (err) {
    console.error('[sync-quotes-nightly] fatal:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err), ...result }), { status: 500 });
  }
}
