// POST /.netlify/functions/cards-approve-staff
//
// Body: { staff_id: string; action: 'approve' | 'reject'; rejection_reason?: string }
//
// Approve: reads the Cards profile from the tenant's data plane → flips
//   field_approved on the canonical app_data.staff row → records the approval
//   in shell_control.cards_field_approvals.
// Reject:  records the rejection only (no data-plane writes).
//
// Manager + platform_admin only.
//
// WHY no more legacy-Field write (2026-06-08): the approved staff member ALREADY
// lives in app_data.staff — the tenant data plane that live Field reads via
// tenant_routing (zaap for EQ, nspb for SKS). The old bridge copied the profile
// into a second store, the standalone ktmj Field DB, which is now the dead
// cold-backup that nothing reads. Approval is therefore a FLAG on the canonical
// row (field_approved, migration 0046), not a second copy of the person.
//
// Data plane:
//   - app_data.staff (field_approved flag)  → tenant DB (via tenant_routing)
//   - shell_control.cards_field_approvals    → control plane (shared, audit)

import { randomUUID } from 'node:crypto';
import { getServiceClient } from './_shared/supabase.js';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry, captureServerError } from './_shared/sentry.js';
import { sendEmail } from './_shared/email.js';

interface ApproveBody {
  staff_id?: string;
  application_id?: string;
  action: 'approve' | 'reject';
  rejection_reason?: string;
  confirmed_staff_id?: string | null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function approveHandler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });

  if (!can(session, 'admin.review_cards')) {
    return json(403, { error: 'Manager access required' });
  }

  let body: ApproveBody;
  try {
    body = (await req.json()) as ApproveBody;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { staff_id, application_id, action, rejection_reason, confirmed_staff_id } = body;
  if (!staff_id && !application_id) {
    return json(400, { error: 'staff_id or application_id is required' });
  }
  if (!action) return json(400, { error: 'action is required' });
  if (action !== 'approve' && action !== 'reject') {
    return json(400, { error: 'action must be approve or reject' });
  }

  const sb = getServiceClient();
  const tenantId = session.tenant_id;

  // ── Application path (worker self-signup) ──────────────────────────────────
  if (application_id) {
    return handleApplication({ application_id, action, rejection_reason, confirmed_staff_id, sb, session, tenantId });
  }

  // ── Invite path (existing app_data.staff row) ──────────────────────────────
  const staff_id_safe = staff_id!;

  // Guard: can't review the same person twice. cards_field_approvals lives
  // in shell_control (cross-tenant audit).
  const { data: existing } = await sb
    .from('cards_field_approvals')
    .select('id, status')
    .eq('staff_id', staff_id_safe)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existing) {
    return json(409, { error: `Already ${existing.status}` });
  }

  if (action === 'reject') {
    // Rejection doesn't read app_data — no tenant DB round-trip needed.
    await sb.from('cards_field_approvals').insert({
      staff_id: staff_id_safe,
      tenant_id: tenantId,
      field_people_id: null,
      status: 'rejected',
      approved_by_user_id: session.user_id,
      rejection_reason: rejection_reason ?? null,
    });
    return json(200, { ok: true, action: 'rejected' });
  }

  // Approve — open the tenant's data plane to read the full profile.
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  // Approve = flip the canonical field_approved flag and read the row back in a
  // single round-trip (UPDATE … RETURNING). The staff member already lives in
  // app_data.staff (the plane live Field reads); approval clears them onto the
  // roster — no second copy into the dead legacy Field DB. Collapsing the prior
  // SELECT-then-UPDATE into one statement removes a round-trip to the tenant
  // data plane, the slow hop on this path.
  const { data: staffRow, error: updErr } = (await tenantAny
    .schema('app_data')
    .from('staff')
    .update({
      field_approved: true,
      field_approved_at: new Date().toISOString(),
      field_approved_by: session.user_id,
    })
    .eq('staff_id', staff_id_safe)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .select('staff_id, field_approved, tenant_id, phone, cards_worker_id')
    .maybeSingle()) as {
    data: { staff_id: string; field_approved: boolean | null; tenant_id: string; phone: string | null; cards_worker_id: string | null } | null;
    error: { message: string } | null;
  };

  if (updErr) {
    return json(500, { error: `Could not approve staff: ${updErr.message}` });
  }
  if (!staffRow) {
    return json(404, { error: 'Staff record not found or not in your tenant' });
  }

  // Grant org membership so licences appear in Shell's canonical licence view.
  // staff-canonical-licences.ts gates on public.org_memberships — without this row
  // the approved worker's licences are invisible even though field_approved is true.
  // Awaited (not fire-and-forget) because an invisible worker is a silent failure.
  //
  // Only runs when cards_worker_id is already set — meaning this staff member has
  // gone through Cards and has a verified workers row. Phone-based lookup is
  // intentionally avoided: it has no tenant scope and would match unrelated workers
  // at other tenants who share the same phone number (cross-tenant data exposure).
  // Workers without a cards_worker_id link haven't self-registered in Cards yet;
  // when they do, the application path handles org_memberships via worker_user_id.
  if (staffRow.cards_worker_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbPub = (sb as any).schema('public');

    // Hoist worker fetch so user_id is available for org_memberships, licence sync,
    // and shell_control.users provisioning.
    const { data: workerRow } = (await sbPub
      .from('workers')
      .select('user_id, email, first_name, last_name, phone')
      .eq('id', staffRow.cards_worker_id)
      .maybeSingle()) as { data: { user_id: string | null; email: string | null; first_name: string | null; last_name: string | null; phone: string | null } | null };

    const { data: orgRow } = (await sbPub
      .from('organisations')
      .select('id')
      .eq('tenant_id', tenantId)
      .maybeSingle()) as { data: { id: string } | null };

    if (orgRow && workerRow?.user_id) {
      const { error: memErr } = await sbPub
        .from('org_memberships')
        .insert({
          org_id: orgRow.id,
          user_id: workerRow.user_id,
          role: 'member',
          status: 'active',
          invited_by: session.user_id,
          invited_at: new Date().toISOString(),
          accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          tenant_id: tenantId,
        });
      // 23505 = unique violation — already a member, which is fine.
      if (memErr && memErr.code !== '23505') {
        console.warn('[cards-approve-staff] org_memberships insert skipped', memErr.message);
      }

      // Provision shell_control.users so the auth hook stamps tenant_id into JWTs.
      // Workers who signed up via phone OTP bypass the Shell invite flow and have no
      // shell_control.users row — the hook passes through with no tenant_id and every
      // function call 401s until this row exists.
      // ON CONFLICT DO NOTHING: properly invited workers already have their row; no-op.
      const workerName = [workerRow.first_name, workerRow.last_name].filter(Boolean).join(' ') || null;
      await sb.from('users').upsert({
        id: workerRow.user_id,
        tenant_id: tenantId,
        role: 'worker',
        email: workerRow.email ?? null,
        name: workerName,
        phone: workerRow.phone ?? null,
      }, { onConflict: 'id', ignoreDuplicates: true });
    }

    if (workerRow?.user_id) {
      const { data: licences } = (await sbPub
        .from('licences')
        .select('id, licence_type, licence_number, issuing_authority, state, issue_date, expiry_date, never_expires')
        .eq('user_id', workerRow.user_id)
        .is('deleted_at', null)
        .not('licence_number', 'is', null)) as { data: Array<{
          id: string; licence_type: string; licence_number: string;
          issuing_authority: string | null; state: string | null;
          issue_date: string | null; expiry_date: string | null; never_expires: boolean;
        }> | null };

      if (licences && licences.length > 0) {
        await (tenantAny
          .schema('app_data')
          .from('licences')
          .upsert(
            licences.map((l) => ({
              licence_id: randomUUID(),
              staff_id: staff_id_safe,
              tenant_id: tenantId,
              licence_type: l.licence_type,
              licence_number: l.licence_number,
              issuing_authority: l.issuing_authority,
              state: l.state,
              issue_date: l.issue_date,
              expiry_date: l.expiry_date,
              active: true,
              cards_credential_id: l.id,
              imported_from: 'cards',
              schema_version: '1',
              metadata: l.never_expires ? { never_expires: true } : null,
            })),
            { onConflict: 'cards_credential_id', ignoreDuplicates: true },
          ) as Promise<unknown>)
          .catch((e: unknown) => console.error('[cards-approve-staff] licence sync failed (invite)', e));
      }
    }
  }

  // Link Cards worker ↔ Field staff record by phone so future credential syncs work.
  // Fire-and-forget — approval is already committed; a FK sync failure must not roll it back.
  if (staffRow.phone) {
    const inviteBare = staffRow.phone.replace(/[^0-9]/g, '');
    const inviteSuffix = inviteBare.startsWith('61')
      ? inviteBare.slice(2)
      : inviteBare.startsWith('0') ? inviteBare.slice(1) : inviteBare;
    const inviteVariants = inviteSuffix
      ? [...new Set([staffRow.phone, `0${inviteSuffix}`, `+61${inviteSuffix}`].filter(Boolean) as string[])]
      : [];
    if (inviteVariants.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sbPub = (sb as any).schema('public');
      (async () => {
        const { data: linkedWorker } = (await sbPub
          .from('workers')
          .select('id')
          .in('phone', inviteVariants)
          .is('staff_id', null)
          .limit(1)
          .maybeSingle()) as { data: { id: string } | null };
        if (!linkedWorker) return;
        await Promise.all([
          sbPub.from('workers').update({ staff_id: staff_id_safe }).eq('id', linkedWorker.id),
          tenantAny.schema('app_data').from('staff')
            .update({ cards_worker_id: linkedWorker.id })
            .eq('staff_id', staff_id_safe)
            .eq('tenant_id', tenantId),
        ]);
      })().catch((e: unknown) => console.error('[cards-approve-staff] invite FK link failed', e));
    }
  }

  // Record the approval in the control plane (cross-tenant audit). field_people_id
  // is retained for legacy rows but is no longer written — approval is canonical.
  const { error: auditErr } = await sb.from('cards_field_approvals').insert({
    staff_id: staff_id_safe,
    tenant_id: tenantId,
    field_people_id: null,
    status: 'approved',
    approved_by_user_id: session.user_id,
  });
  if (auditErr) {
    captureServerError(auditErr, { fn: 'cards-approve-staff', context: 'audit-insert-invite' });
    console.error('[cards-approve-staff] audit insert failed (invite path)', auditErr);
  }

  // Canonical heartbeat — every approval lands a row in canonical_events so the
  // sentient layer has a durable audit trail. Fire-and-forget: the approval is
  // already committed above; a logging failure must not roll it back.
  tenantAny
    .schema('app_data')
    .from('canonical_events')
    .insert({
      tenant_id: tenantId,
      app_source: 'shell',
      event: 'staff.approved',
      payload: { staff_id: staff_id_safe, approved_by: session.user_id },
      occurred_at: new Date().toISOString(),
      idempotency_key: `staff.approved:${staff_id_safe}`,
    })
    .then(() => {/* ok */})
    .catch((err: unknown) => {
      captureServerError(err, { fn: 'cards-approve-staff', context: 'canonical-events-invite' });
      console.error('[cards-approve-staff] canonical_events emit failed', err);
    });

  return json(200, { ok: true, action: 'approved', staff_id: staff_id_safe });
}

export default withSentry(async (req: Request): Promise<Response> => {
  // A throw below would otherwise surface as a bare 502 with no body (Netlify's
  // platform error) — and withSentry only reports it when SENTRY_DSN is set on
  // the deploy. Convert any uncaught error into a structured 500 so the caller
  // sees the real reason and approvals never fail silently.
  try {
    return await approveHandler(req);
  } catch (err) {
    captureServerError(err, { fn: 'cards-approve-staff' });
    return json(500, { error: err instanceof Error ? err.message : 'Unexpected server error' });
  }
});

// ── Self-signup application approval ──────────────────────────────────────────

interface AppSession {
  user_id: string;
  tenant_id: string;
}

async function handleApplication({
  application_id,
  action,
  confirmed_staff_id,
  sb,
  session,
  tenantId,
}: {
  application_id: string;
  action: 'approve' | 'reject';
  rejection_reason?: string;
  confirmed_staff_id?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any;
  session: AppSession;
  tenantId: string;
}): Promise<Response> {
  const sbPublic = sb.schema('public');

  // Fetch and validate the application
  const { data: app, error: appErr } = await sbPublic
    .from('org_access_requests')
    .select('id, org_id, worker_user_id, worker_phone, sharing_scope, status, requested_by')
    .eq('id', application_id)
    .maybeSingle() as { data: {
      id: string; org_id: string; worker_user_id: string;
      worker_phone: string | null; sharing_scope: string;
      status: string; requested_by: string;
    } | null; error: { message: string } | null };

  if (appErr || !app) {
    return json(404, { error: 'Application not found' });
  }
  if (app.status !== 'pending') {
    return json(409, { error: `Already ${app.status}` });
  }
  if (app.requested_by !== app.worker_user_id) {
    return json(400, { error: 'Not a worker-initiated application' });
  }

  // Verify the application is for this manager's org (via tenant_id)
  const { data: org } = await sbPublic
    .from('organisations')
    .select('id, tenant_id, name')
    .eq('id', app.org_id)
    .maybeSingle() as { data: { id: string; tenant_id: string; name: string | null } | null };

  if (!org || org.tenant_id !== tenantId) {
    return json(403, { error: 'Application does not belong to your organisation' });
  }

  if (action === 'reject') {
    await sbPublic
      .from('org_access_requests')
      .update({ status: 'rejected', responded_at: new Date().toISOString() })
      .eq('id', application_id);
    return json(200, { ok: true, action: 'rejected' });
  }

  // Approve — fetch the worker profile from canonical DB
  const { data: worker } = await sbPublic
    .from('workers')
    .select(
      'id, user_id, first_name, last_name, email, phone, date_of_birth, ' +
      'address_street, address_suburb, address_state, address_postcode',
    )
    .eq('user_id', app.worker_user_id)
    .maybeSingle() as { data: {
      id: string; user_id: string;
      first_name: string | null; last_name: string | null;
      email: string | null; phone: string | null; date_of_birth: string | null;
      address_street: string | null; address_suburb: string | null;
      address_state: string | null; address_postcode: string | null;
    } | null };

  // Open tenant data plane to create the staff record
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  // Phone formats are inconsistent: GoTrue normalises to +61XXXXXXXXX, employers type
  // 0XXXXXXXXX, and the org_access_requests RPC strips to bare 9 digits. Check all three.
  const workerPhone = worker?.phone ?? app.worker_phone;
  const bareDigits = (workerPhone ?? '').replace(/^\+61/, '').replace(/^0/, '').replace(/\s/g, '');
  const phoneVariants = bareDigits
    ? [...new Set([workerPhone, `0${bareDigits}`, `+61${bareDigits}`].filter(Boolean) as string[])]
    : [];

  // Resolve which app_data.staff record to use.
  //   confirmed_staff_id !== undefined  → admin chose via the match panel (non-null = link existing, null = create new)
  //   confirmed_staff_id === undefined  → auto-detect: cards_worker_id first (authoritative), then phone
  let staffId: string;
  let isExistingStaff: boolean;

  if (confirmed_staff_id !== undefined) {
    staffId = confirmed_staff_id !== null ? confirmed_staff_id : randomUUID();
    isExistingStaff = confirmed_staff_id !== null;
  } else {
    let autoDetected: { staff_id: string } | null = null;

    // 1. Primary: look for a Field record already linked to this canonical worker.
    //    This is the most reliable signal — set on previous approvals and unaffected
    //    by phone format variations.
    if (worker?.id) {
      ({ data: autoDetected } = (await tenantAny
        .schema('app_data')
        .from('staff')
        .select('staff_id')
        .eq('tenant_id', tenantId)
        .eq('cards_worker_id', worker.id)
        .limit(1)
        .maybeSingle()) as { data: { staff_id: string } | null });
    }

    // 2. Fallback: match by phone across normalised variants.
    if (!autoDetected && phoneVariants.length > 0) {
      ({ data: autoDetected } = (await tenantAny
        .schema('app_data')
        .from('staff')
        .select('staff_id')
        .eq('tenant_id', tenantId)
        .in('phone', phoneVariants)
        .limit(1)
        .maybeSingle()) as { data: { staff_id: string } | null });
    }

    staffId = autoDetected?.staff_id ?? randomUUID();
    isExistingStaff = !!autoDetected;
  }

  // Dedup guard: when admin explicitly chose "create new" via the match panel
  // (confirmed_staff_id === null), the phone/email checks above were skipped.
  // Guard against phone-format variants (0x vs +61x) or email collisions that
  // the match panel may have missed. If we find a definitive match, use it.
  if (!isExistingStaff && confirmed_staff_id === null) {
    let guardMatch: { staff_id: string } | null = null;
    if (worker?.email) {
      ({ data: guardMatch } = (await tenantAny
        .schema('app_data')
        .from('staff')
        .select('staff_id')
        .eq('tenant_id', tenantId)
        .eq('email', worker.email)
        .limit(1)
        .maybeSingle()) as { data: { staff_id: string } | null });
    }
    if (!guardMatch && phoneVariants.length > 0) {
      ({ data: guardMatch } = (await tenantAny
        .schema('app_data')
        .from('staff')
        .select('staff_id')
        .eq('tenant_id', tenantId)
        .in('phone', phoneVariants)
        .limit(1)
        .maybeSingle()) as { data: { staff_id: string } | null });
    }
    if (guardMatch) {
      console.warn(`[cards-approve-staff] dedup guard: matched existing staff ${guardMatch.staff_id} by email/phone — linking instead of creating`);
      staffId = guardMatch.staff_id;
      isExistingStaff = true;
    }
  }

  if (!isExistingStaff) {
    const { error: staffInsertErr } = await tenantAny
      .schema('app_data')
      .from('staff')
      .insert({
        staff_id: staffId,
        tenant_id: tenantId,
        first_name: worker?.first_name ?? null,
        last_name: worker?.last_name ?? null,
        email: worker?.email ?? null,
        phone: workerPhone,
        date_of_birth: worker?.date_of_birth ?? null,
        address_street: worker?.address_street ?? null,
        address_suburb: worker?.address_suburb ?? null,
        address_state: worker?.address_state ?? null,
        address_postcode: worker?.address_postcode ?? null,
        active: true,
        field_approved: true,
        field_approved_at: new Date().toISOString(),
        field_approved_by: session.user_id,
        imported_from: 'eq-cards-application',
      });

    if (staffInsertErr) {
      return json(500, { error: `Could not create staff record: ${staffInsertErr.message}` });
    }
  }

  // Copy licences from Cards (public.licences on jvkn) into Field (app_data.licences on ehow).
  // Source is public.licences — worker_credentials is a dead table (0 rows).
  // Dedup via cards_credential_id unique constraint (ON CONFLICT DO NOTHING) so re-approvals
  // and existing-staff merges are both safe without a pre-fetch round-trip.
  if (app.sharing_scope === 'full' && worker?.user_id) {
    const { data: licences } = (await sbPublic
      .from('licences')
      .select('id, licence_type, licence_number, issuing_authority, state, issue_date, expiry_date, never_expires')
      .eq('user_id', worker.user_id)
      .is('deleted_at', null)
      .not('licence_number', 'is', null)) as { data: Array<{
        id: string; licence_type: string; licence_number: string;
        issuing_authority: string | null; state: string | null;
        issue_date: string | null; expiry_date: string | null; never_expires: boolean;
      }> | null };

    if (licences && licences.length > 0) {
      await tenantAny
        .schema('app_data')
        .from('licences')
        .upsert(
          licences.map((l) => ({
            licence_id: randomUUID(),
            staff_id: staffId,
            tenant_id: tenantId,
            licence_type: l.licence_type,
            licence_number: l.licence_number,
            issuing_authority: l.issuing_authority,
            state: l.state,
            issue_date: l.issue_date,
            expiry_date: l.expiry_date,
            active: true,
            cards_credential_id: l.id,
            imported_from: 'cards',
            schema_version: '1',
            metadata: l.never_expires ? { never_expires: true } : null,
          })),
          { onConflict: 'cards_credential_id', ignoreDuplicates: true },
        );
    }
  }

  // Link Cards worker ↔ Field staff record so future credential syncs work automatically.
  // Fire-and-forget — approval is already committed; FK sync failure must not roll it back.
  if (worker?.id) {
    const workerId = worker.id;
    (async () => {
      const { data: currentWorker } = (await sbPublic
        .from('workers')
        .select('staff_id')
        .eq('id', workerId)
        .maybeSingle()) as { data: { staff_id: string | null } | null };

      const tasks: Promise<unknown>[] = [
        tenantAny.schema('app_data').from('staff')
          .update({ cards_worker_id: workerId })
          .eq('staff_id', staffId)
          .eq('tenant_id', tenantId),
      ];

      const existingStaffId = currentWorker?.staff_id ?? null;
      if (!existingStaffId || existingStaffId === staffId) {
        // Safe to set: either unset or already pointing at this record (idempotent).
        tasks.push(sbPublic.from('workers').update({ staff_id: staffId }).eq('id', workerId));
      } else {
        // workers.staff_id already points somewhere else. Log and skip — don't clobber
        // a link that may have been set by a previous (correct) approval.
        console.warn('[cards-approve-staff] workers.staff_id already set, skipping overwrite', {
          worker_id: workerId, existing: existingStaffId, resolved: staffId,
        });
      }

      await Promise.all(tasks);
    })().catch((e: unknown) => console.error('[cards-approve-staff] application FK link failed', e));
  }

  // Mark application approved in canonical DB
  await sbPublic
    .from('org_access_requests')
    .update({ status: 'approved', responded_at: new Date().toISOString() })
    .eq('id', application_id);

  // Connect the worker to this org in Cards (org_memberships)
  const { error: memberErr } = await sbPublic
    .from('org_memberships')
    .insert({
      org_id: app.org_id,
      user_id: app.worker_user_id,
      role: 'member',
      status: 'active',
      invited_by: session.user_id,
      invited_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tenant_id: tenantId,
    });
  // 23505 = unique violation — already a member, which is fine.
  if (memberErr && memberErr.code !== '23505') {
    console.warn('[cards-approve-staff] org_memberships insert failed', memberErr.message);
  }

  // Provision the worker's Shell access to this employer tenant, and ensure
  // shell_control.users exists so the auth hook stamps tenant_id into JWTs.
  // Workers who self-signed-up via phone OTP have no shell_control.users row —
  // the hook passes through with no tenant_id until one is created here.
  // Both are fire-and-forget: approval is already committed above.
  const appWorkerName = [worker?.first_name, worker?.last_name].filter(Boolean).join(' ') || null;
  sb.from('user_tenant_memberships')
    .insert({
      user_id: app.worker_user_id,
      tenant_id: tenantId,
      role: 'worker',
      active: false,
    })
    .then(() => {/* ok */})
    .catch((err: unknown) => {
      console.warn('[cards-approve-staff] user_tenant_memberships insert failed', err);
    });
  sb.from('users').upsert({
    id: app.worker_user_id,
    tenant_id: tenantId,
    role: 'worker',
    email: worker?.email ?? null,
    name: appWorkerName,
    phone: workerPhone ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true })
    .then(() => {/* ok */})
    .catch((err: unknown) => {
      console.warn('[cards-approve-staff] shell_control.users provision failed', err);
    });

  // Audit record in the control plane
  const { error: auditAppErr } = await sb.from('cards_field_approvals').insert({
    staff_id: staffId,
    tenant_id: tenantId,
    field_people_id: null,
    status: 'approved',
    approved_by_user_id: session.user_id,
  });
  if (auditAppErr) {
    captureServerError(auditAppErr, { fn: 'cards-approve-staff', context: 'audit-insert-application' });
    console.error('[cards-approve-staff] audit insert failed (application path)', auditAppErr);
  }

  // Notify the worker their connection was approved. Non-fatal — never block
  // the approval on email delivery. Fire-and-forget (no await).
  if (worker?.email) {
    const orgName = org?.name ?? 'your employer';
    const firstName = worker.first_name ?? 'there';
    sendEmail({
      to: worker.email,
      subject: `You're connected to ${orgName} on EQ Cards`,
      text: `Hi ${firstName},\n\n${orgName} has approved your EQ Cards connection. Open the app — your workspace is ready.\n\ncards.eq.solutions`,
      html: `<p>Hi ${firstName},</p><p><strong>${orgName}</strong> has approved your EQ Cards connection. Open the app — your workspace is ready.</p><p><a href="https://cards.eq.solutions">Open EQ Cards →</a></p>`,
    }).catch((err: unknown) => {
      console.warn('[cards-approve-staff] worker approval email failed (non-fatal)', err);
    });
  }

  return json(200, { ok: true, action: 'approved', staff_id: staffId, application_id });
}

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { error: `No tenant data plane registered for this session (${e.identifier}). Run scripts/provision-tenant.mjs.` });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { error: `Tenant data plane not active (status: ${e.status}). Cutover incomplete.` });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[cards-approve-staff] tenant routing misconfigured', e);
    return json(500, { error: 'Tenant routing unavailable — see server logs' });
  }
  console.error('[cards-approve-staff] unexpected tenant resolution error', e);
  return json(500, { error: 'Tenant resolution failed' });
}
