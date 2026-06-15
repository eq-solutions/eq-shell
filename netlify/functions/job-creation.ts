// POST /.netlify/functions/job-creation
// Body: { quote_id: string }
//
// Server-side Job Creation Excel generator. Mirrors the Flask implementation in
// eq-quotes-port/app/quotes/job_creation.py exactly.
//
// Loads the template from the site's static files, fills in the quote cells
// using exceljs (preserves formulas + dropdowns that SheetJS drops), and
// returns the binary xlsx.
//
// Budget cell mapping (per user spec):
//   I4 / J4  = SLAB  — labour COST / 1
//   I3 / J3  = MAT   — (material + one_off) COST / 1
//   I11/ J11 = SUBC  — subcontractor COST / 1
//   I2 formula stays — ='Job Creation'!B11  (revenue / subtotal ex GST)
//
// Cost per line: cost_rate_cents × qty_thousandths / 1000
// If cost_rate_cents is 0, the line contributes 0 to the cost bucket.

import type { Context } from '@netlify/functions';
import ExcelJS from 'exceljs';
import {
  getTenantRpcClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

function jsonErr(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError)    return jsonErr(404, 'tenant_not_found');
  if (e instanceof TenantNotActiveError)   return jsonErr(403, 'tenant_inactive');
  if (e instanceof TenantRoutingMisconfiguredError) return jsonErr(500, 'routing_misconfigured');
  return jsonErr(500, 'routing_error');
}

interface JobCreationLine {
  category: string;
  qty_thousandths: number;
  unit_rate_cents: number;
  cost_rate_cents: number;
}

interface JobCreationData {
  quote_number: string;
  po_number: string | null;
  project_name: string | null;
  customer_name: string | null;
  customer_abn: string | null;
  customer_email: string | null;
  estimator_name: string | null;
  subtotal_cents: number;
  lines: JobCreationLine[];
}

function sanitiseFilename(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '-');
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed');

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return jsonErr(401, 'not_signed_in');

  let body: { quote_id?: string };
  try {
    body = (await req.json()) as { quote_id?: string };
  } catch {
    return jsonErr(400, 'invalid_json');
  }
  const quoteId = body?.quote_id;
  if (!quoteId) return jsonErr(400, 'quote_id_required');

  let rpcClient;
  try {
    rpcClient = await getTenantRpcClientById(session.tenant_id);
  } catch (e) {
    return tenantRoutingError(e);
  }

  const { data: jobData, error: rpcErr } = await rpcClient.rpc('eq_get_job_creation', {
    p_quote_id: quoteId,
    p_tenant_id: session.tenant_id,
  });
  if (rpcErr) return jsonErr(500, rpcErr.message);
  const d = jobData as JobCreationData;

  // ── Load template from site static files ──────────────────────────────────
  const siteUrl = process.env.URL ?? process.env.DEPLOY_URL ?? 'http://localhost:8888';
  const templateResp = await fetch(`${siteUrl}/templates/sks-job-creation-template.xlsx`);
  if (!templateResp.ok) return jsonErr(500, 'template_load_failed');
  const templateBuffer = await templateResp.arrayBuffer();

  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(templateBuffer as any);

  // ── Job Creation sheet ───────────────────────────────────────────────────
  const jc = wb.getWorksheet('Job Creation');
  if (!jc) return jsonErr(500, 'template_missing_job_creation_sheet');

  jc.getCell('B4').value = d.project_name ?? '';
  jc.getCell('B5').value = d.customer_name ?? '';
  jc.getCell('B7').value = d.estimator_name ?? 'Royce Milmlow';
  jc.getCell('B8').value = d.estimator_name ?? 'Royce Milmlow';
  // B11: job value ex GST — stored as a number so Excel's currency format applies
  jc.getCell('B11').value = d.subtotal_cents / 100;
  // B12: PO number if known
  jc.getCell('B12').value = d.po_number ?? '';
  // B14: SKS quote number
  jc.getCell('B14').value = d.quote_number ?? '';
  // B17/B18: clear hyperlink + set text
  const b17 = jc.getCell('B17');
  b17.value = d.customer_email ?? '';
  b17.style = { ...b17.style };     // detach shared style reference
  // B18: ABN
  jc.getCell('B18').value = d.customer_abn ?? '';
  // Dropdowns from "Data (do not use)" sheet — matches Ramsay V7 template
  const dataSheet = "'Data (do not use)'";
  jc.getCell('B6').dataValidation  = { type: 'list', allowBlank: true, formulae: [`${dataSheet}!$A$1:$A$2`] };   // Job Type
  jc.getCell('B9').dataValidation  = { type: 'list', allowBlank: true, formulae: [`${dataSheet}!$A$8:$A$15`] };  // State
  jc.getCell('B10').dataValidation = { type: 'list', allowBlank: true, formulae: [`${dataSheet}!$A$17:$A$18`] }; // Billing Type
  jc.getCell('B15').dataValidation = { type: 'list', allowBlank: true, formulae: [`${dataSheet}!$A$4:$A$6`] };   // Job Group
  jc.getCell('B16').dataValidation = { type: 'list', allowBlank: true, formulae: [`${dataSheet}!$A$24:$A$25`] }; // Payapps
  jc.getCell('B20').dataValidation = { type: 'list', allowBlank: true, formulae: [`${dataSheet}!$A$20:$A$21`] }; // Retention
  // B27/B28/B29: Client ID / Market Segment / Market Vertical — from Extention Column Tabs
  const extSheet = "'Extention Column Tabs'";
  jc.getCell('B27').dataValidation = { type: 'list', allowBlank: true, formulae: [`${extSheet}!$A$2:$A$7`] };
  jc.getCell('B28').dataValidation = { type: 'list', allowBlank: true, formulae: [`${extSheet}!$B$2:$B$7`] };
  jc.getCell('B29').dataValidation = { type: 'list', allowBlank: true, formulae: [`${extSheet}!$C$2:$C$20`] };

  // ── Budget sheet ─────────────────────────────────────────────────────────
  const bud = wb.getWorksheet('Budget');
  if (!bud) return jsonErr(500, 'template_missing_budget_sheet');

  // Bucket line item COSTS by category.
  // one_off folds into MAT per user spec.
  let labourCost = 0;
  let materialCost = 0;
  let subconCost = 0;

  for (const line of d.lines ?? []) {
    const qty = line.qty_thousandths / 1000;
    const costCents = (line.cost_rate_cents ?? 0) * qty;
    const cat = (line.category ?? '').toLowerCase();
    if (cat === 'labour')                            labourCost   += costCents;
    else if (cat === 'material' || cat === 'one_off') materialCost += costCents;
    else if (cat === 'subcontractor')                subconCost   += costCents;
  }

  // Write cost buckets and revenue total directly — ExcelJS doesn't recalculate
  // formulas on write, so we supply all values explicitly.
  bud.getCell('I2').value  = d.subtotal_cents / 100;  // REV cost (= job value ex GST)
  bud.getCell('J2').value  = 1;
  bud.getCell('K2').value  = d.subtotal_cents / 100;  // FC Retail total
  bud.getCell('I3').value  = materialCost / 100;      // MAT unit cost
  bud.getCell('J3').value  = 1;
  bud.getCell('K3').value  = materialCost / 100;
  bud.getCell('I4').value  = labourCost / 100;        // SLAB unit cost
  bud.getCell('J4').value  = 1;
  bud.getCell('K4').value  = labourCost / 100;
  bud.getCell('I11').value = subconCost / 100;        // SUBC unit cost
  bud.getCell('J11').value = 1;
  bud.getCell('K11').value = subconCost / 100;

  // ── Serialise and return ──────────────────────────────────────────────────
  const outBuffer = await wb.xlsx.writeBuffer();
  const safeNumber = sanitiseFilename(d.quote_number);
  const safeName   = d.customer_name ? `-${sanitiseFilename(d.customer_name)}` : '';
  const filename   = `JobCreation-${safeNumber}${safeName}.xlsx`;

  return new Response(outBuffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
