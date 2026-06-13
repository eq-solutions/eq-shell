// @ts-nocheck
// DEAD CODE — nspbmirochztcjijmcrx ABANDONED 2026-06-13. Do not activate.
// Types intentionally suppressed: schema evolved past this file's type assumptions.
//
// netlify/functions/sync-quotes-nightly.ts
//
// Nightly ETL: eq-quotes (nspbmirochztcjijmcrx) → sks-canonical (ehowgjardagevnrluult)
//
// Runs 09:00 AEST (23:00 UTC) each night. Idempotent — safe to re-run.
// Syncs customers → quotes → line items, writes canonical_id back to Flask.
//
// Required Netlify env vars (add via Netlify UI → Site vars):
//   NSPBMIR_SUPABASE_URL       https://nspbmirochztcjijmcrx.supabase.co
//   NSPBMIR_SERVICE_KEY        service_role key from Supabase dashboard
//   EHOW_SERVICE_KEY           service_role key for ehowgjardagevnrluult
//
// Already in Netlify (no action needed):
//   CANONICAL_SUPABASE_URL     https://ehowgjardagevnrluult.supabase.co

import type { Config } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

export const config: Config = {
  schedule: '0 23 * * *',
};

const SKS_ORG_ID   = '1eb831f9-aeae-4e57-b49e-9681e8f51e15';
const TENANT_ID    = '7dee117c-98bd-4d39-af8c-2c81d02a1e85';

const STATUS_MAP: Record<string, string> = {
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

  const source = createClient(nspbmirUrl, nspbmirKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const canonical = createClient(ehowUrl, ehowKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = { customers: 0, quotes: 0, lineItems: 0, errors: 0 };

  try {
    // Step 1: Sync customers
    const { data: customers, error: custErr } = await source
      .from('sks_quotes_customers')
      .select('id, name')
      .eq('archived', false);
    if (custErr) throw new Error(`fetch customers: ${custErr.message}`);

    const custRows = customers!.map(r => ({
      tenant_id:      TENANT_ID,
      external_id:    r.id,
      type:           'company',
      company_name:   r.name,
      imported_from:  'eq-quotes',
      schema_version: '1.0.0',
    }));

    const { data: upsertedCusts, error: uCustErr } = await canonical
      .schema('app_data')
      .from('customers')
      .upsert(custRows, { onConflict: 'tenant_id,external_id', ignoreDuplicates: false })
      .select('customer_id, external_id');
    if (uCustErr) throw new Error(`upsert customers: ${uCustErr.message}`);

    const custIdMap: Record<string, string> = {};
    (upsertedCusts ?? []).forEach(r => { custIdMap[r.external_id] = r.customer_id; });
    result.customers = upsertedCusts?.length ?? 0;

    // Step 2: Load canonical sites for matching
    const { data: sites, error: sitesErr } = await canonical
      .schema('app_data')
      .from('sites')
      .select('site_id, name, code')
      .eq('tenant_id', TENANT_ID);
    if (sitesErr) throw new Error(`fetch sites: ${sitesErr.message}`);

    const siteByName: Record<string, string> = {};
    const siteByCode: Record<string, string> = {};
    (sites ?? []).forEach(s => {
      if (s.name) siteByName[s.name.toLowerCase().trim()] = s.site_id;
      if (s.code) siteByCode[s.code.toLowerCase().trim()] = s.site_id;
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

    // Step 3: Sync quotes
    const { data: quotes, error: quotesErr } = await source
      .from('sks_quotes')
      .select([
        'id', 'number', 'status', 'customer_id', 'site', 'project_name',
        'attn_name', 'attn_first_name', 'attn_phone', 'address', 'scope_of_works',
        'estimator_name', 'estimator_initials', 'margin_pct', 'sent_at',
        'sent_by_initials', 'validity_days', 'payment_terms', 'expires_at',
        'workbench_job_no', 'client_accepted_at', 'client_accepted_by',
        'client_declined_at', 'loss_reason', 'canonical_id', 'created_at',
        'labour', 'materials', 'subcon', 'prelims', 'inclusions',
      ].join(','))
      .eq('org_id', SKS_ORG_ID)
      .is('deleted_at', null);
    if (quotesErr) throw new Error(`fetch quotes: ${quotesErr.message}`);

    for (const q of quotes ?? []) {
      const canonicalCustomerId = custIdMap[q.customer_id];
      if (!canonicalCustomerId) {
        console.warn(`[sync-quotes-nightly] no canonical customer for ${q.number}`);
        continue;
      }

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

      const quoteRow = {
        tenant_id:          TENANT_ID,
        customer_id:        canonicalCustomerId,
        site_id:            resolveSiteId(q.site),
        quote_number:       q.number ?? null,
        external_id:        q.id,
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
        workbench_job_no:   q.workbench_job_no ?? null,
        client_accepted_at: q.client_accepted_at ?? null,
        client_accepted_by: q.client_accepted_by ?? null,
        client_declined_at: q.client_declined_at ?? null,
        loss_reason:        q.loss_reason ?? null,
        imported_from:      'eq-quotes',
        schema_version:     '1.0.0',
        imported_at:        new Date().toISOString(),
      };

      // Upsert by quote_id PK using canonical_id if known, else gen new
      const quoteId = q.canonical_id ?? undefined;
      const upsertRow = quoteId ? { ...quoteRow, quote_id: quoteId } : quoteRow;

      const { data: upserted, error: uQuoteErr } = await canonical
        .schema('app_data')
        .from('quote')
        .upsert(upsertRow, { onConflict: 'quote_id', ignoreDuplicates: false })
        .select('quote_id')
        .single();

      if (uQuoteErr || !upserted) {
        console.error(`[sync-quotes-nightly] upsert quote ${q.number}:`, uQuoteErr?.message);
        result.errors++;
        continue;
      }

      // Write canonical_id back to Flask if new
      if (!q.canonical_id) {
        await source
          .from('sks_quotes')
          .update({ canonical_id: upserted.quote_id, updated_at: new Date().toISOString() })
          .eq('id', q.id);
      }

      // Replace line items
      await canonical
        .schema('app_data')
        .from('quote_line_item')
        .delete()
        .eq('quote_id', upserted.quote_id);

      if (lineItems.length > 0) {
        const rows = lineItems.map(li => ({ ...li, quote_id: upserted.quote_id }));
        const { error: liErr } = await canonical
          .schema('app_data')
          .from('quote_line_item')
          .insert(rows);
        if (liErr) {
          console.warn(`[sync-quotes-nightly] line items ${q.number}:`, liErr.message);
        } else {
          result.lineItems += rows.length;
        }
      }

      result.quotes++;
    }

    console.info('[sync-quotes-nightly] complete', result);
    return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });

  } catch (err) {
    result.errors++;
    console.error('[sync-quotes-nightly] fatal:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err), ...result }), { status: 500 });
  }
}
