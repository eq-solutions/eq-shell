// POST /.netlify/functions/backfill-worker-links
//
// Admin-only cross-DB backfill: links canonical workers to their ehow staff
// records and shell users.
//
// PROBLEM:
//   - public.workers on jvkn (eq-canonical) holds 39 workers.
//   - 33+ have user_id = NULL — they cannot authenticate to EQ Field.
//   - Many also have staff_id = NULL — not linked to the ehow data plane.
//   - app_data.staff on ehow has cards_worker_id = NULL for most rows.
//
// THIS FUNCTION DOES THREE THINGS:
//   1. workers.user_id  — match worker.email → shell_control.users.email;
//                         write user_id. (Same logic as link-workers.ts but
//                         also updates auth.users mirror.)
//   2. workers.staff_id — match worker.email → app_data.staff.email on the
//                         tenant data plane; write staff_id on the worker.
//   3. staff.cards_worker_id — the reverse: write workers.id back onto the
//                         matching app_data.staff row so Field can resolve
//                         the worker in both directions.
//
// All three phases run in a single call. Phase 1 operates on jvkn only.
// Phases 2-3 require a tenant_slug (or tenant_id) so the routing layer
// can open the correct data-plane client (ehow for 'sks').
//
// Request (POST, JSON body):
//   {
//     tenant_slug: string,  // e.g. "sks" — the tenant whose staff table to query
//     dry_run?: boolean,    // default: true — must pass false to execute writes
//   }
//
// Response:
//   {
//     ok: true,
//     dry_run: boolean,
//     phase1_user_id:    { linked: N, already_linked: N, no_match: N, errors: [...] },
//     phase2_staff_id:   { linked: N, already_linked: N, no_match: N, errors: [...] },
//     phase3_reverse:    { linked: N, already_linked: N, no_match: N, errors: [...] },
//   }
//
// Auth: is_platform_admin (session cookie). Never callable by tenant users.
//
// Safe to call multiple times — skips rows that are already linked.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import {
  getTenantDataClientById,
  getTenantDataClient,
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

function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  return t.includes('@') ? t : null;
}

interface WorkerRow {
  id: string;
  email: string | null;
  user_id: string | null;
  staff_id: string | null;
}

interface ShellUserRow {
  id: string;
  email: string;
}

interface StaffRow {
  staff_id: string;
  email: string | null;
  cards_worker_id: string | null;
}

interface PhaseResult {
  linked: number;
  already_linked: number;
  no_match: number;
  errors: Array<{ id: string; message: string }>;
}

function emptyPhase(): PhaseResult {
  return { linked: 0, already_linked: 0, no_match: 0, errors: [] };
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method-not-allowed' });

  // Auth — platform admin only (cross-tenant write).
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'unauthenticated' });
  if (!session.is_platform_admin) return json(403, { ok: false, error: 'forbidden' });

  let body: { tenant_slug?: string; tenant_id?: string; dry_run?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { ok: false, error: 'bad-request — JSON body required' });
  }

  const tenantSlug = (body.tenant_slug ?? '').trim();
  const tenantIdParam = (body.tenant_id ?? '').trim();
  if (!tenantSlug && !tenantIdParam) {
    return json(400, { ok: false, error: 'bad-request — tenant_slug or tenant_id required' });
  }

  const dryRun = body.dry_run !== false; // safe default: true

  const sb = getServiceClient(); // jvkn canonical (shell_control + public schemas)

  // ── Load all canonical workers ─────────────────────────────────────────
  const { data: workersData, error: workersErr } = await sb
    .schema('public')
    .from('workers')
    .select('id, email, user_id, staff_id');
  if (workersErr) {
    return json(500, { ok: false, error: 'failed-to-read-workers', detail: workersErr.message });
  }
  const workers = (workersData ?? []) as WorkerRow[];

  // ── Load shell_control.users for phase 1 ───────────────────────────────
  const { data: shellUsersData, error: shellUsersErr } = await sb
    .from('users')
    .select('id, email');
  if (shellUsersErr) {
    return json(500, { ok: false, error: 'failed-to-read-users', detail: shellUsersErr.message });
  }
  const shellUsers = (shellUsersData ?? []) as ShellUserRow[];

  const shellUserByEmail = new Map<string, ShellUserRow>();
  for (const u of shellUsers) {
    const e = normaliseEmail(u.email);
    if (e) shellUserByEmail.set(e, u);
  }

  // ── Load tenant data-plane staff for phases 2 + 3 ─────────────────────
  let tenantDb: Awaited<ReturnType<typeof getTenantDataClient>>;
  try {
    if (tenantSlug) {
      tenantDb = await getTenantDataClient(tenantSlug);
    } else {
      tenantDb = await getTenantDataClientById(tenantIdParam);
    }
  } catch (e) {
    if (e instanceof TenantNotFoundError) {
      return json(404, { ok: false, error: `No data plane for tenant "${e.identifier}"` });
    }
    if (e instanceof TenantNotActiveError) {
      return json(503, { ok: false, error: `Tenant data plane not active (${e.status})` });
    }
    if (e instanceof TenantRoutingMisconfiguredError) {
      console.error('[backfill-worker-links] tenant routing misconfigured', e);
      return json(500, { ok: false, error: 'Tenant routing unavailable — see server logs' });
    }
    console.error('[backfill-worker-links] unexpected tenant resolution error', e);
    return json(500, { ok: false, error: 'Tenant resolution failed' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;
  const { data: staffData, error: staffErr } = (await tenantAny
    .schema('app_data')
    .from('staff')
    .select('staff_id, email, cards_worker_id')
    .eq('active', true)) as {
    data: StaffRow[] | null;
    error: { message: string } | null;
  };
  if (staffErr) {
    return json(500, { ok: false, error: 'failed-to-read-staff', detail: staffErr.message });
  }
  const staffRows = (staffData ?? []) as StaffRow[];

  const staffByEmail = new Map<string, StaffRow>();
  for (const s of staffRows) {
    const e = normaliseEmail(s.email);
    if (e) staffByEmail.set(e, s);
  }

  // ── Phase 1 — workers.user_id ──────────────────────────────────────────
  const p1 = emptyPhase();
  for (const worker of workers) {
    if (worker.user_id) {
      p1.already_linked++;
      continue;
    }
    const email = normaliseEmail(worker.email);
    if (!email) {
      p1.no_match++;
      continue;
    }
    const shellUser = shellUserByEmail.get(email);
    if (!shellUser) {
      p1.no_match++;
      continue;
    }

    if (!dryRun) {
      const { error: updErr } = await sb
        .schema('public')
        .from('workers')
        .update({ user_id: shellUser.id })
        .eq('id', worker.id)
        .is('user_id', null); // concurrent-safe guard
      if (updErr) {
        p1.errors.push({ id: worker.id, message: updErr.message });
        continue;
      }
    }
    p1.linked++;
  }

  // ── Phase 2 — workers.staff_id (canonical → ehow link) ────────────────
  const p2 = emptyPhase();
  for (const worker of workers) {
    if (worker.staff_id) {
      p2.already_linked++;
      continue;
    }
    const email = normaliseEmail(worker.email);
    if (!email) {
      p2.no_match++;
      continue;
    }
    const staff = staffByEmail.get(email);
    if (!staff) {
      p2.no_match++;
      continue;
    }

    if (!dryRun) {
      const { error: updErr } = await sb
        .schema('public')
        .from('workers')
        .update({ staff_id: staff.staff_id })
        .eq('id', worker.id)
        .is('staff_id', null); // concurrent-safe guard
      if (updErr) {
        p2.errors.push({ id: worker.id, message: updErr.message });
        continue;
      }
    }
    p2.linked++;
  }

  // ── Phase 3 — app_data.staff.cards_worker_id (reverse link ehow → canonical) ──
  const p3 = emptyPhase();
  for (const worker of workers) {
    const email = normaliseEmail(worker.email);
    if (!email) continue;

    const staff = staffByEmail.get(email);
    if (!staff) continue;

    if (staff.cards_worker_id) {
      p3.already_linked++;
      continue;
    }

    if (!dryRun) {
      const { error: updErr } = (await tenantAny
        .schema('app_data')
        .from('staff')
        .update({ cards_worker_id: worker.id })
        .eq('staff_id', staff.staff_id)
        .is('cards_worker_id', null)) as { error: { message: string } | null };
      if (updErr) {
        p3.errors.push({ id: staff.staff_id, message: updErr.message });
        continue;
      }
    }
    p3.linked++;
  }

  return json(200, {
    ok: true,
    dry_run: dryRun,
    workers_total: workers.length,
    tenant: tenantSlug || tenantIdParam,
    phase1_user_id: p1,
    phase2_staff_id: p2,
    phase3_reverse: p3,
  });
});
