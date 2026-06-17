// POST /.netlify/functions/crm-write
// Body: { action: 'update_customer' | 'update_contact' | 'update_site' | 'merge_customers' |
//         'link_contact_customer' | 'unlink_contact_customer', id: string, ...fields }
//
// Writes CRM records to app_data via service-role client.
// Tenant isolation enforced by matching session.tenant_id in the WHERE clause.

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

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const { action, id } = body;
  if (typeof action !== 'string' || typeof id !== 'string' || !id) {
    return json(400, { ok: false, error: 'missing_action_or_id' });
  }

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    if (e instanceof TenantNotFoundError)           return json(500, { ok: false, error: 'tenant_not_provisioned' });
    if (e instanceof TenantNotActiveError)          return json(503, { ok: false, error: 'tenant_inactive' });
    if (e instanceof TenantRoutingMisconfiguredError) return json(500, { ok: false, error: 'routing_misconfigured' });
    return json(500, { ok: false, error: 'internal_error' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb  = tenantDb as any; // default schema = app_data
  const now = new Date().toISOString();
  const tid = session.tenant_id;

  // ── update_customer ────────────────────────────────────────────────────────
  if (action === 'update_customer') {
    const patch: Record<string, unknown> = { updated_at: now };
    const companyName = str(body.company_name);
    if (companyName !== null) patch.company_name = companyName; // never blank the name
    patch.email         = str(body.email);
    patch.primary_phone = str(body.primary_phone);
    patch.suburb        = str(body.suburb);
    patch.state         = str(body.state);

    const { error } = await sb
      .from('customers')
      .update(patch)
      .eq('customer_id', id)
      .eq('tenant_id', tid);
    if (error) {
      console.error('[crm-write] update_customer failed', error.message);
      return json(500, { ok: false, error: error.message });
    }
    return json(200, { ok: true });
  }

  // ── update_contact ─────────────────────────────────────────────────────────
  if (action === 'update_contact') {
    const { error } = await sb
      .from('contacts')
      .update({
        first_name:   str(body.first_name),
        last_name:    str(body.last_name),
        email:        str(body.email),
        mobile_phone: str(body.mobile_phone),
        position:     str(body.position),
        updated_at:   now,
      })
      .eq('contact_id', id)
      .eq('tenant_id', tid);
    if (error) {
      console.error('[crm-write] update_contact failed', error.message);
      return json(500, { ok: false, error: error.message });
    }
    return json(200, { ok: true });
  }

  // ── archive_site ───────────────────────────────────────────────────────────
  if (action === 'archive_site') {
    const { error } = await sb.from('sites')
      .update({ active: false, updated_at: now })
      .eq('site_id', id).eq('tenant_id', tid);
    if (error) return json(500, { ok: false, error: error.message });
    return json(200, { ok: true });
  }

  // ── delete_site ────────────────────────────────────────────────────────────
  // Hard delete — fails with 409 if the site has linked service records.
  if (action === 'delete_site') {
    const { error } = await sb.from('sites')
      .delete().eq('site_id', id).eq('tenant_id', tid);
    if (error) {
      if (error.code === '23503') return json(409, { ok: false, error: 'site_has_records' });
      return json(500, { ok: false, error: error.message });
    }
    return json(200, { ok: true });
  }

  // ── update_site ────────────────────────────────────────────────────────────
  if (action === 'update_site') {
    const patch: Record<string, unknown> = { updated_at: now };
    const name = str(body.name);
    if (name !== null) patch.name = name; // never blank the name
    patch.code               = str(body.code);
    patch.suburb             = str(body.suburb);
    patch.state              = str(body.state);
    patch.site_contact_name  = str(body.site_contact_name);
    patch.site_contact_phone = str(body.site_contact_phone);
    patch.site_contact_email = str(body.site_contact_email);

    const { error } = await sb
      .from('sites')
      .update(patch)
      .eq('site_id', id)
      .eq('tenant_id', tid);
    if (error) {
      console.error('[crm-write] update_site failed', error.message);
      return json(500, { ok: false, error: error.message });
    }
    return json(200, { ok: true });
  }

  // ── merge_customers ────────────────────────────────────────────────────────
  // Moves all sites + contacts from loser customer(s) to the winner, then archives losers.
  if (action === 'merge_customers') {
    const rawLosers = body.loser_ids;
    if (!Array.isArray(rawLosers) || rawLosers.length === 0) {
      return json(400, { ok: false, error: 'loser_ids_required' });
    }
    const losers = rawLosers.filter((x): x is string => typeof x === 'string');
    if (losers.length === 0) return json(400, { ok: false, error: 'loser_ids_must_be_strings' });

    const { error: e1 } = await sb.from('sites')
      .update({ customer_id: id, updated_at: now })
      .in('customer_id', losers).eq('tenant_id', tid);
    if (e1) return json(500, { ok: false, error: e1.message });

    const { error: e2 } = await sb.from('contacts')
      .update({ customer_id: id, updated_at: now })
      .in('customer_id', losers).eq('tenant_id', tid);
    if (e2) return json(500, { ok: false, error: e2.message });

    const { error: e3 } = await sb.from('customers')
      .update({ active: false, updated_at: now })
      .in('customer_id', losers).eq('tenant_id', tid);
    if (e3) return json(500, { ok: false, error: e3.message });

    // Clean up stale contact_customer_links (graceful — table may not exist pre-0133)
    try {
      // a) Cross-links pointing to archived losers are now stale
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sb as any).from('contact_customer_links')
        .delete().in('customer_id', losers).eq('tenant_id', tid);
      // b) Contacts moved to winner may have had a cross-link to winner — now self-referential
      const { data: wc } = await sb.from('contacts')
        .select('contact_id').eq('customer_id', id).eq('tenant_id', tid);
      const wcIds = ((wc ?? []) as { contact_id: string }[]).map((r) => r.contact_id);
      if (wcIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (sb as any).from('contact_customer_links')
          .delete().in('contact_id', wcIds).eq('customer_id', id).eq('tenant_id', tid);
      }
    } catch { /* contact_customer_links table not yet applied (pre-0133) — safe to ignore */ }

    return json(200, { ok: true });
  }

  // ── link_contact_customer ──────────────────────────────────────────────────
  // Associates a contact with an additional customer (requires migration 0133).
  if (action === 'link_contact_customer') {
    const customerId = str(body.customer_id);
    if (!customerId) return json(400, { ok: false, error: 'customer_id_required' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb as any).from('contact_customer_links')
      .upsert({ contact_id: id, customer_id: customerId, tenant_id: tid }, { onConflict: 'contact_id,customer_id' });
    if (error) return json(500, { ok: false, error: error.message });
    return json(200, { ok: true });
  }

  // ── unlink_contact_customer ────────────────────────────────────────────────
  if (action === 'unlink_contact_customer') {
    const customerId = str(body.customer_id);
    if (!customerId) return json(400, { ok: false, error: 'customer_id_required' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb as any).from('contact_customer_links')
      .delete().eq('contact_id', id).eq('customer_id', customerId).eq('tenant_id', tid);
    if (error) return json(500, { ok: false, error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { ok: false, error: 'unknown_action' });
});
