// GET /.netlify/functions/crm-customers?action=list
// GET /.netlify/functions/crm-customers?action=detail&id=<customer_id>
// GET /.netlify/functions/crm-customers?action=unassigned
//
// Backs the Customers CRM hub (CustomersHubPage). Does the customer→sites→
// contacts joins the generic entity-rows browser can't: list = customers with
// site/contact counts (+ orphan totals); detail = one customer with its nested
// sites (incl. on-site contact) and contacts; unassigned = sites/contacts with
// no customer_id. Tenant resolved from the session cookie; the tenant data
// client is app_data-schema + service-role (RLS bypassed server-side).

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

interface CustomerRow {
  customer_id: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  customer_group: string | null;
  state: string | null;
  suburb?: string | null;
  active: boolean | null;
  primary_phone?: string | null;
  mobile_phone?: string | null;
  email?: string | null;
}
interface SiteRow {
  site_id: string; customer_id: string | null; name: string | null; site_type: string | null;
  code: string | null; suburb: string | null; state: string | null;
  site_contact_name: string | null; site_contact_phone: string | null; site_contact_email: string | null;
}
interface ContactRow {
  contact_id: string; customer_id: string | null; first_name: string | null; last_name: string | null;
  position: string | null; email: string | null; work_phone: string | null; mobile_phone: string | null;
}

function customerName(c: CustomerRow): string {
  return c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unnamed customer';
}
function personName(p: { first_name: string | null; last_name: string | null }): string {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || '—';
}

const SITE_COLS = 'site_id, customer_id, name, site_type, code, suburb, state, site_contact_name, site_contact_phone, site_contact_email';
const CONTACT_COLS = 'contact_id, customer_id, first_name, last_name, position, email, work_phone, mobile_phone';

function mapSite(s: SiteRow) {
  return {
    id: s.site_id, name: s.name ?? 'Unnamed site', kind: s.site_type ?? null,
    code: s.code ?? null, suburb: s.suburb ?? null, state: s.state ?? null,
    contact: s.site_contact_name
      ? { name: s.site_contact_name, phone: s.site_contact_phone ?? null, email: s.site_contact_email ?? null }
      : null,
  };
}
function mapContact(
  c: ContactRow,
  extraCustomers: { id: string; name: string }[] = [],
  linkedSites: { id: string; name: string }[] = [],
) {
  return {
    id: c.contact_id, name: personName(c),
    first_name: c.first_name ?? null, last_name: c.last_name ?? null,
    role: c.position ?? null,
    email: c.email ?? null, phone: c.mobile_phone ?? c.work_phone ?? null,
    extra_customers: extraCustomers,
    linked_sites: linkedSites,
  };
}

// ── Dedup helpers (bigram Dice coefficient — same algorithm as eq-intake duplicate-detect) ─
function bgrams(s: string): Set<string> {
  const g = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
}
function diceCoeff(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const gA = bgrams(a), gB = bgrams(b);
  let m = 0; gA.forEach((g) => { if (gB.has(g)) m++; });
  return (2 * m) / (gA.size + gB.size);
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  // Reading the customer book requires entity.view — the canonical read perm
  // (@eq-solutions/roles), held by manager/supervisor/employee/apprentice but NOT
  // labour_hire. Matches the write side (crm-write) and entity-rows; the Customers
  // hub UI is already entity.view-gated, so this closes the direct-API hole.
  if (!can(session, 'entity.view')) {
    return json(403, { ok: false, error: 'forbidden', detail: 'entity.view permission required' });
  }

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = tenantDb as any; // default schema = app_data

  const url = new URL(req.url);
  const action = url.searchParams.get('action') ?? 'list';

  if (action === 'list') {
    // Single PostgREST query: customers + per-customer site/contact counts via lateral
    // aggregate (PostgREST v10+). Two HEAD-only queries for orphan totals — no row data
    // returned, count comes back in the response header.
    const [custRes, orphanSiteRes, orphanContactRes] = await Promise.all([
      sb.from('customers')
        .select('customer_id, company_name, first_name, last_name, customer_group, state, active, sites(count), contacts(count)')
        .order('company_name', { ascending: true, nullsFirst: false })
        .order('first_name', { ascending: true, nullsFirst: false }),
      sb.from('sites').select('*', { count: 'exact', head: true }).is('customer_id', null).eq('active', true),
      sb.from('contacts').select('*', { count: 'exact', head: true }).is('customer_id', null),
    ]);
    if (custRes.error) return json(500, { ok: false, error: 'db_error', detail: custRes.error.message });

    type CustWithCounts = CustomerRow & { sites: [{ count: number }] | null; contacts: [{ count: number }] | null };
    const customers = ((custRes.data ?? []) as CustWithCounts[]).map((c) => ({
      id: c.customer_id,
      name: customerName(c),
      group: c.customer_group ?? null,
      state: c.state ?? null,
      active: c.active !== false,
      site_count: c.sites?.[0]?.count ?? 0,
      contact_count: c.contacts?.[0]?.count ?? 0,
    }));

    return json(200, {
      ok: true,
      customers,
      unassigned: { sites: orphanSiteRes.count ?? 0, contacts: orphanContactRes.count ?? 0 },
    });
  }

  if (action === 'detail') {
    const id = url.searchParams.get('id');
    if (!id) return json(400, { ok: false, error: 'missing_id' });
    const [custRes, siteRes, contactRes] = await Promise.all([
      sb.from('customers').select('customer_id, company_name, first_name, last_name, customer_group, state, suburb, active, primary_phone, mobile_phone, email').eq('customer_id', id).maybeSingle(),
      sb.from('sites').select(SITE_COLS).eq('customer_id', id).eq('active', true).order('name'),
      sb.from('contacts').select(CONTACT_COLS).eq('customer_id', id).order('last_name'),
    ]);
    if (custRes.error) return json(500, { ok: false, error: 'db_error', detail: custRes.error.message });
    if (!custRes.data) return json(404, { ok: false, error: 'not_found' });
    const c = custRes.data as CustomerRow;
    const contactRows = (contactRes.data ?? []) as ContactRow[];

    // Fetch cross-customer links (requires migration 0133 — gracefully degrades if not yet applied)
    const crossByContact = new Map<string, { id: string; name: string }[]>();
    try {
      const contactIds = contactRows.map((r) => r.contact_id);
      if (contactIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const xlRes = await (sb as any).from('contact_customer_links')
          .select('contact_id, customer_id').in('contact_id', contactIds);
        if (!xlRes.error && xlRes.data?.length > 0) {
          const xlCustIds = [...new Set((xlRes.data as { contact_id: string; customer_id: string }[]).map((r) => r.customer_id))];
          const xlCustRes = await sb.from('customers')
            .select('customer_id, company_name, first_name, last_name').in('customer_id', xlCustIds as string[]);
          const custMap = new Map(
            ((xlCustRes.data ?? []) as CustomerRow[]).map((cr) => [cr.customer_id, customerName(cr)])
          );
          for (const row of xlRes.data as { contact_id: string; customer_id: string }[]) {
            if (row.customer_id === id) continue; // skip self-referential links (artefacts of past merges)
            const list = crossByContact.get(row.contact_id) ?? [];
            list.push({ id: row.customer_id, name: custMap.get(row.customer_id) ?? 'Unknown' });
            crossByContact.set(row.contact_id, list);
          }
        }
      }
    } catch { /* migration 0133 not yet applied */ }

    // Fetch contact-site links (mig 0118 — gracefully degrades if not yet applied)
    const sitesByContact = new Map<string, { id: string; name: string }[]>();
    try {
      const contactIds = contactRows.map((r) => r.contact_id);
      if (contactIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const slRes = await (sb as any).from('contact_site_links')
          .select('contact_id, site_id').in('contact_id', contactIds).eq('active', true);
        if (!slRes.error && slRes.data?.length > 0) {
          const slSiteIds = [...new Set((slRes.data as { contact_id: string; site_id: string }[]).map((r) => r.site_id))];
          const slSiteRes = await sb.from('sites').select('site_id, name').in('site_id', slSiteIds as string[]);
          const siteMap = new Map(
            ((slSiteRes.data ?? []) as { site_id: string; name: string | null }[]).map((sr) => [sr.site_id, sr.name ?? 'Unnamed site'])
          );
          for (const row of slRes.data as { contact_id: string; site_id: string }[]) {
            const list = sitesByContact.get(row.contact_id) ?? [];
            list.push({ id: row.site_id, name: siteMap.get(row.site_id) ?? 'Unnamed site' });
            sitesByContact.set(row.contact_id, list);
          }
        }
      }
    } catch { /* contact_site_links not yet applied */ }

    return json(200, {
      ok: true,
      customer: {
        id: c.customer_id, name: customerName(c), group: c.customer_group ?? null,
        state: c.state ?? null, suburb: c.suburb ?? null, active: c.active !== false,
        phone: c.primary_phone ?? c.mobile_phone ?? null, email: c.email ?? null,
      },
      sites: ((siteRes.data ?? []) as SiteRow[]).map(mapSite),
      contacts: contactRows.map((ct) => mapContact(ct, crossByContact.get(ct.contact_id), sitesByContact.get(ct.contact_id))),
    });
  }

  if (action === 'dedup') {
    type DedupRow = { contact_id: string; first_name: string | null; last_name: string | null; email: string | null; customer_id: string | null };
    const { data, error } = await (sb as any).from('contacts').select('contact_id, first_name, last_name, email, customer_id').eq('active', true);
    if (error) return json(500, { ok: false, error: error.message });
    const rows = (data ?? []) as DedupRow[];
    const norm = (r: DedupRow) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim().toLowerCase();
    const matches: Record<string, { partnerId: string; partnerName: string; partnerCustomerId: string; confidence: 'high' | 'medium' }[]> = {};
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        let confidence: 'high' | 'medium' | null = null;
        if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
          confidence = 'high';
        } else {
          const nameA = norm(a), nameB = norm(b);
          if (nameA.length >= 2 && nameB.length >= 2) {
            const sim = diceCoeff(nameA, nameB);
            if (sim >= 0.85) confidence = 'high';
            else if (sim >= 0.65) confidence = 'medium';
          }
        }
        if (confidence) {
          const aName = norm(a) || '—', bName = norm(b) || '—';
          (matches[a.contact_id] ??= []).push({ partnerId: b.contact_id, partnerName: bName, partnerCustomerId: b.customer_id ?? '', confidence });
          (matches[b.contact_id] ??= []).push({ partnerId: a.contact_id, partnerName: aName, partnerCustomerId: a.customer_id ?? '', confidence });
        }
      }
    }
    return json(200, { ok: true, matches });
  }

  if (action === 'unassigned') {
    const [siteRes, contactRes] = await Promise.all([
      sb.from('sites').select(SITE_COLS).is('customer_id', null).order('name'),
      sb.from('contacts').select(CONTACT_COLS).is('customer_id', null).order('last_name'),
    ]);
    return json(200, {
      ok: true,
      sites: ((siteRes.data ?? []) as SiteRow[]).map(mapSite),
      contacts: ((contactRes.data ?? []) as ContactRow[]).map((c) => mapContact(c)),
    });
  }

  return json(400, { ok: false, error: 'unknown_action' });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) return json(500, { ok: false, error: 'tenant_not_provisioned' });
  if (e instanceof TenantNotActiveError) return json(503, { ok: false, error: 'tenant_inactive' });
  if (e instanceof TenantRoutingMisconfiguredError) return json(500, { ok: false, error: 'routing_misconfigured' });
  console.error('[crm-customers] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
