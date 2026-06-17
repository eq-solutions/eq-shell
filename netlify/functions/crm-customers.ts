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
function mapContact(c: ContactRow) {
  return {
    id: c.contact_id, name: personName(c),
    first_name: c.first_name ?? null, last_name: c.last_name ?? null,
    role: c.position ?? null,
    email: c.email ?? null, phone: c.mobile_phone ?? c.work_phone ?? null,
  };
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

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
    const [custRes, siteRes, contactRes] = await Promise.all([
      sb.from('customers').select('customer_id, company_name, first_name, last_name, customer_group, state, active').order('created_at', { ascending: false }),
      sb.from('sites').select('customer_id'),
      sb.from('contacts').select('customer_id'),
    ]);
    if (custRes.error) return json(500, { ok: false, error: 'db_error', detail: custRes.error.message });

    const siteCounts = new Map<string, number>();
    let orphanSites = 0;
    for (const s of (siteRes.data ?? []) as { customer_id: string | null }[]) {
      if (s.customer_id) siteCounts.set(s.customer_id, (siteCounts.get(s.customer_id) ?? 0) + 1);
      else orphanSites++;
    }
    const contactCounts = new Map<string, number>();
    let orphanContacts = 0;
    for (const c of (contactRes.data ?? []) as { customer_id: string | null }[]) {
      if (c.customer_id) contactCounts.set(c.customer_id, (contactCounts.get(c.customer_id) ?? 0) + 1);
      else orphanContacts++;
    }

    const customers = ((custRes.data ?? []) as CustomerRow[]).map((c) => ({
      id: c.customer_id,
      name: customerName(c),
      group: c.customer_group ?? null,
      state: c.state ?? null,
      active: c.active !== false,
      site_count: siteCounts.get(c.customer_id) ?? 0,
      contact_count: contactCounts.get(c.customer_id) ?? 0,
    }));

    return json(200, { ok: true, customers, unassigned: { sites: orphanSites, contacts: orphanContacts } });
  }

  if (action === 'detail') {
    const id = url.searchParams.get('id');
    if (!id) return json(400, { ok: false, error: 'missing_id' });
    const [custRes, siteRes, contactRes] = await Promise.all([
      sb.from('customers').select('customer_id, company_name, first_name, last_name, customer_group, state, suburb, active, primary_phone, mobile_phone, email').eq('customer_id', id).maybeSingle(),
      sb.from('sites').select(SITE_COLS).eq('customer_id', id).order('name'),
      sb.from('contacts').select(CONTACT_COLS).eq('customer_id', id).order('last_name'),
    ]);
    if (custRes.error) return json(500, { ok: false, error: 'db_error', detail: custRes.error.message });
    if (!custRes.data) return json(404, { ok: false, error: 'not_found' });
    const c = custRes.data as CustomerRow;
    return json(200, {
      ok: true,
      customer: {
        id: c.customer_id, name: customerName(c), group: c.customer_group ?? null,
        state: c.state ?? null, suburb: c.suburb ?? null, active: c.active !== false,
        phone: c.primary_phone ?? c.mobile_phone ?? null, email: c.email ?? null,
      },
      sites: ((siteRes.data ?? []) as SiteRow[]).map(mapSite),
      contacts: ((contactRes.data ?? []) as ContactRow[]).map(mapContact),
    });
  }

  if (action === 'unassigned') {
    const [siteRes, contactRes] = await Promise.all([
      sb.from('sites').select(SITE_COLS).is('customer_id', null).order('name'),
      sb.from('contacts').select(CONTACT_COLS).is('customer_id', null).order('last_name'),
    ]);
    return json(200, {
      ok: true,
      sites: ((siteRes.data ?? []) as SiteRow[]).map(mapSite),
      contacts: ((contactRes.data ?? []) as ContactRow[]).map(mapContact),
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
