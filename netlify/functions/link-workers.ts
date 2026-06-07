// POST /.netlify/functions/link-workers
//
// For each worker in public.workers (jvkn) that has no user_id, attempt to
// match them to a shell_control.users row by phone or email and write the
// user_id back. This is the missing piece for Cards→Field SSO: a worker who
// has accepted their Shell invite exists in shell_control.users, but their
// workers.user_id may still be NULL if the invite was accepted before the
// link-on-accept path existed or their invite had no worker_id stamped.
//
// Request (POST, JSON body):
//   { dry_run?: boolean }   — dry_run defaults to TRUE; must explicitly pass
//                             dry_run: false to execute any UPDATEs.
//
// Response:
//   { ok: true, dry_run: boolean, linked: N, already_linked: M, no_match: K,
//     errors: Array<{ worker_id: string; message: string }> }
//
// Auth: is_platform_admin check — this is a cross-tenant operation and must
// never be callable by ordinary tenant users.
//
// Schema note:
//   - public.workers on jvkn (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY):
//       id uuid PK, user_id uuid FK → shell_control.users.id, phone text, email text
//   - shell_control.users on jvkn (same Supabase):
//       id uuid PK, email text, phone text (nullable)
//   Both are on the same Supabase project — no second DB client required.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Normalise a phone string: strip spaces, dashes, parentheses. */
function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/[\s\-().+]/g, '');
  if (!stripped) return null;
  return stripped;
}

/** Normalise an email: lowercase and trim. */
function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed;
}

interface WorkerRow {
  id: string;
  user_id: string | null;
  phone: string | null;
  email: string | null;
}

interface UserRow {
  id: string;
  email: string;
  phone: string | null;
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  // Auth: must be a valid session and must be a platform admin.
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'unauthenticated' });
  if (!session.is_platform_admin) return json(403, { ok: false, error: 'forbidden' });

  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  let dryRun = true; // safe default — must opt in to writes
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.dry_run === false) dryRun = false;
  } catch {
    // Body absent or not JSON — treat as dry_run: true (safe default).
  }

  const sb = getServiceClient();

  // 1. Load all shell_control.users (they are the link targets).
  //    We want every user with a phone or email so we can match against workers.
  const { data: usersData, error: usersErr } = await sb
    .from('users')
    .select('id, email, phone');
  if (usersErr) {
    return json(500, { ok: false, error: 'failed_to_read_users', detail: usersErr.message });
  }
  const users = (usersData ?? []) as UserRow[];

  // Build lookup maps for O(1) matching.
  const userByEmail = new Map<string, UserRow>();
  const userByPhone = new Map<string, UserRow>();
  for (const u of users) {
    const email = normaliseEmail(u.email);
    if (email) userByEmail.set(email, u);
    const phone = normalisePhone(u.phone);
    if (phone) userByPhone.set(phone, u);
  }

  // 2. Load all public.workers. The table is in the public schema on jvkn.
  const { data: workersData, error: workersErr } = await sb
    .schema('public')
    .from('workers')
    .select('id, user_id, phone, email');
  if (workersErr) {
    return json(500, { ok: false, error: 'failed_to_read_workers', detail: workersErr.message });
  }
  const workers = (workersData ?? []) as WorkerRow[];

  // 3. Match and (if not dry_run) update.
  let linked = 0;
  let alreadyLinked = 0;
  let noMatch = 0;
  const errors: Array<{ worker_id: string; message: string }> = [];

  for (const worker of workers) {
    // Already linked — nothing to do.
    if (worker.user_id) {
      alreadyLinked++;
      continue;
    }

    // Try to find a matching shell user.
    let matchedUser: UserRow | undefined;

    // Phone match first (more reliable for workers).
    const workerPhone = normalisePhone(worker.phone);
    if (workerPhone) {
      matchedUser = userByPhone.get(workerPhone);
    }

    // Email match as fallback.
    if (!matchedUser) {
      const workerEmail = normaliseEmail(worker.email);
      if (workerEmail) {
        matchedUser = userByEmail.get(workerEmail);
      }
    }

    if (!matchedUser) {
      noMatch++;
      continue;
    }

    // Match found and worker.user_id is NULL — link them.
    if (!dryRun) {
      const { error: updateErr } = await sb
        .schema('public')
        .from('workers')
        .update({ user_id: matchedUser.id })
        .eq('id', worker.id)
        .is('user_id', null); // guard: only update if still NULL (concurrent safety)
      if (updateErr) {
        errors.push({ worker_id: worker.id, message: updateErr.message });
        continue;
      }
    }
    linked++;
  }

  return json(200, {
    ok: true,
    dry_run: dryRun,
    linked,
    already_linked: alreadyLinked,
    no_match: noMatch,
    errors,
  });
});
