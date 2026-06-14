// Server-side PDF generation for quotes using Puppeteer + @sparticuz/chromium.
// Returns a Buffer containing the PDF bytes.

import type { SupabaseClient } from '@supabase/supabase-js';

interface LineItem {
  description: string;
  quantity: number;
  unit: string | null;
  unit_rate: number;
  line_total: number;
  category: string;
}

interface PortalQuote {
  quote_number: string;
  project_name: string | null;
  scope_of_works: string | null;
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  sent_at: string | null;
  estimator_name: string | null;
  estimator_initials: string | null;
  attn_name: string | null;
  attn_first_name: string | null;
  line_items: LineItem[];
}

interface PortalCustomer {
  company_name: string | null;
  abn: string | null;
  phone: string | null;
  email: string | null;
}

export interface QuotePdfData {
  quote: PortalQuote & {
    address?: string | null;
    clarifications?: string | null;
    workbench_job_no?: string | null;
    validity_days?: number | null;
  };
  customer: PortalCustomer;
}

function fmt(cents: number): string {
  return (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

const CAT_ORDER = ['labour', 'material', 'subcontractor', 'one_off', ''];
const CAT_LABELS: Record<string, string> = {
  labour: 'Labour',
  material: 'Materials',
  subcontractor: 'Subcontractors',
  one_off: 'One-off',
  '': 'Other',
};

function buildHtml(d: QuotePdfData): string {
  const q = d.quote;
  const c = d.customer;

  // Group line items by category
  const grouped = new Map<string, LineItem[]>();
  for (const cat of CAT_ORDER) grouped.set(cat, []);
  for (const li of (q.line_items ?? [])) {
    const key = CAT_ORDER.includes(li.category) ? li.category : '';
    grouped.get(key)!.push(li);
  }

  let lineItemsHtml = '';
  for (const cat of CAT_ORDER) {
    const items = grouped.get(cat)!;
    if (items.length === 0) continue;
    lineItemsHtml += `<tr class="cat-row"><td colspan="5">${CAT_LABELS[cat] ?? cat}</td></tr>`;
    for (const li of items) {
      lineItemsHtml += `<tr>
        <td>${escapeHtml(li.description)}</td>
        <td class="num">${li.quantity % 1 === 0 ? li.quantity.toFixed(0) : li.quantity.toFixed(2)}</td>
        <td>${escapeHtml(li.unit)}</td>
        <td class="num">$${fmt(li.unit_rate * 100)}</td>
        <td class="num">$${fmt(li.line_total * 100)}</td>
      </tr>`;
    }
  }

  const sentDate = q.sent_at
    ? new Date(q.sent_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });

  const attn = [q.attn_first_name, q.attn_name].filter(Boolean).join(' ');
  const validity = q.validity_days ?? 30;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #222; padding: 40px 48px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1F335C; padding-bottom: 16px; margin-bottom: 20px; }
  .company-name { font-size: 18pt; font-weight: 700; color: #1F335C; letter-spacing: -0.5px; }
  .company-sub { font-size: 9pt; color: #555; margin-top: 2px; }
  .quote-meta { text-align: right; }
  .quote-number { font-size: 14pt; font-weight: 700; color: #1F335C; }
  .quote-date { font-size: 9pt; color: #555; margin-top: 4px; }
  .attn-block { margin-bottom: 18px; }
  .attn-block .to { font-weight: 600; margin-bottom: 2px; }
  .section-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #1F335C; margin: 16px 0 6px; }
  .scope { line-height: 1.5; margin-bottom: 16px; color: #333; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #1F335C; color: #fff; padding: 6px 8px; font-size: 9pt; text-align: left; }
  th.num { text-align: right; }
  td { padding: 5px 8px; font-size: 9pt; border-bottom: 1px solid #eee; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; }
  tr.cat-row td { background: #f0f4f8; font-weight: 600; color: #1F335C; padding: 4px 8px; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3px; border: none; }
  .totals { width: 260px; margin-left: auto; border: 1px solid #ddd; }
  .totals td { padding: 5px 10px; font-size: 9.5pt; border-bottom: 1px solid #eee; }
  .totals td:last-child { text-align: right; font-weight: 600; }
  .totals tr:last-child td { background: #1F335C; color: #fff; font-weight: 700; }
  .clarifications { margin-top: 16px; line-height: 1.5; color: #333; font-size: 9pt; }
  .footer { margin-top: 32px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 8pt; color: #888; display: flex; justify-content: space-between; }
  .validity { margin-top: 14px; font-size: 9pt; color: #444; font-style: italic; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company-name">SKS Technologies</div>
      <div class="company-sub">Electrical &amp; Data Services</div>
    </div>
    <div class="quote-meta">
      <div class="quote-number">Quote ${escapeHtml(q.quote_number)}</div>
      <div class="quote-date">${sentDate}</div>
      ${q.estimator_name ? `<div class="quote-date">${escapeHtml(q.estimator_name)}</div>` : ''}
    </div>
  </div>

  <div class="attn-block">
    ${attn ? `<div class="to">Attention: ${escapeHtml(attn)}</div>` : ''}
    ${c.company_name ? `<div>${escapeHtml(c.company_name)}</div>` : ''}
    ${q.address ? `<div>${escapeHtml(q.address)}</div>` : ''}
    ${c.email ? `<div>${escapeHtml(c.email)}</div>` : ''}
    ${c.phone ? `<div>${escapeHtml(c.phone)}</div>` : ''}
  </div>

  <div class="section-title">RE: ${escapeHtml(q.project_name)}</div>

  ${q.scope_of_works ? `
  <div class="section-title">Scope of Works</div>
  <div class="scope">${escapeHtml(q.scope_of_works)}</div>
  ` : ''}

  <div class="section-title">Pricing</div>
  <table>
    <thead>
      <tr>
        <th style="width:46%">Description</th>
        <th class="num" style="width:8%">Qty</th>
        <th style="width:8%">Unit</th>
        <th class="num" style="width:14%">Rate</th>
        <th class="num" style="width:14%">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemsHtml}
    </tbody>
  </table>

  <table class="totals">
    <tr><td>Subtotal (ex GST)</td><td>$${fmt(q.subtotal_cents)}</td></tr>
    <tr><td>GST (10%)</td><td>$${fmt(q.gst_cents)}</td></tr>
    <tr><td>Total (inc GST)</td><td>$${fmt(q.total_cents)}</td></tr>
  </table>

  ${q.clarifications ? `
  <div class="section-title">Clarifications &amp; Exclusions</div>
  <div class="clarifications">${escapeHtml(q.clarifications)}</div>
  ` : ''}

  <div class="validity">This quote is valid for ${validity} days from the date above.</div>

  <div class="footer">
    <span>SKS Technologies Pty Ltd</span>
    ${c.abn ? `<span>ABN ${escapeHtml(c.abn)}</span>` : '<span></span>'}
    <span>Page 1 of 1</span>
  </div>
</body>
</html>`;
}

export async function generateQuotePdf(d: QuotePdfData): Promise<Buffer> {
  // Dynamic import — keeps the function bundle small; chromium is external.
  const [chromiumMod, puppeteerMod] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);
  const chromium = chromiumMod.default;
  const puppeteer = puppeteerMod.default;

  const browser = await puppeteer.launch({
    args: chromium.args,
    // @ts-expect-error @sparticuz/chromium types dropped defaultViewport in the
    // current version; the value is still provided at runtime (undefined is also
    // tolerated by puppeteer, which falls back to its default viewport).
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    // @ts-expect-error puppeteer-core's setContent types narrow waitUntil to
    // load|domcontentloaded in this version; 'networkidle0' is a valid runtime
    // lifecycle event and is kept deliberately for correct PDF rendering.
    await page.setContent(buildHtml(d), { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// Load quote data for PDF generation from a Supabase client (authenticated).
export async function loadQuotePdfData(
  supabase: SupabaseClient,
  quoteId: string,
): Promise<QuotePdfData | null> {
  const { data, error } = await supabase.rpc('eq_get_quote_detail', { p_quote_id: quoteId });
  if (error || !data) return null;

  // eq_get_quote_detail returns an array — take the first row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = data as any[];
  if (!rows || rows.length === 0) return null;
  const q = rows[0];

  // Build customer from the quote detail fields
  const customer: PortalCustomer = {
    company_name: q.customer_name ?? null,
    abn: null,
    phone: q.attn_phone ?? null,
    email: null,
  };

  const lineItems: LineItem[] = (q.line_items ?? []).map((li: Record<string, unknown>) => ({
    description: String(li.description ?? ''),
    quantity: Number(li.quantity_thousandths ?? 0) / 1000,
    unit: li.unit ? String(li.unit) : null,
    unit_rate: Number(li.unit_rate_cents ?? 0) / 100,
    line_total: Number(li.line_total_cents ?? 0) / 100,
    category: String(li.category ?? ''),
  }));

  return {
    quote: {
      quote_number: String(q.quote_number ?? ''),
      project_name: q.project_name ?? null,
      scope_of_works: q.scope_of_works ?? null,
      subtotal_cents: Number(q.subtotal_cents ?? 0),
      gst_cents: Number(q.gst_cents ?? 0),
      total_cents: Number(q.total_cents ?? 0),
      sent_at: q.sent_at ?? null,
      estimator_name: q.estimator_name ?? null,
      estimator_initials: q.estimator_initials ?? null,
      attn_name: q.attn_name ?? null,
      attn_first_name: q.attn_first_name ?? null,
      address: q.address ?? null,
      clarifications: q.clarifications ?? null,
      workbench_job_no: q.workbench_job_no ?? null,
      validity_days: q.validity_days ?? null,
      line_items: lineItems,
    },
    customer,
  };
}
