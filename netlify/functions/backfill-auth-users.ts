// POST /.netlify/functions/backfill-auth-users
//
// One-shot admin utility — creates auth.users rows for every
// shell_control.users entry that doesn't already have one.
//
// Background: accept-invite (pre-fix) created shell_control.users rows
// without mirroring them to auth.users. The Shell-minted JWT sub =
// shell_control user id, so Supabase's getUser() rejects the token
// (auth.users has no matching row), causing Cards iframe setSession to 401.
//
// This function queries all active shell_control users, checks auth.users
// for each, and creates the missing entries with the same UUID + email.
//
// SECURITY: platform-admin only. Called once after deploying the
// accept-invite fix. Safe to call multiple times — createUser returns
// "User already registered" for existing rows which we skip.
//
// Usage:
//   curl -X POST https://core.eq.solutions/.netlify/functions/backfill-auth-users \
//     -H "Cookie: eq_shell_session=<your-admin-session>"

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, hasSecretSalt } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!hasSecretSalt()) return jsonResponse(500, { error: 'Server misconfigured' });

  const cookieToken = readSessionCookie(req);
  const session = verifySessionToken(cookieToken);
  if (!session || !session.is_platform_admin) {
    return jsonResponse(403, { error: 'Platform admin required' });
  }

  let sb;
  try { sb = getServiceClient(); } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  const { data: users, error: listErr } = await sb
    .from('users')
    .select('id, email, active')
    .returns<Pick<CanonicalUser, 'id' | 'email' | 'active'>[]>();

  if (listErr || !users) {
    return jsonResponse(500, { error: listErr?.message ?? 'Could not list users' });
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const failures: { id: string; email: string; error: string }[] = [];

  for (const user of users) {
    const { error: createErr } = await sb.auth.admin.createUser({
      id: user.id,
      email: user.email,
      email_confirm: true,
    });

    if (!createErr || createErr.message === 'User already registered') {
      if (!createErr) created++;
      else skipped++;
    } else {
      failed++;
      failures.push({ id: user.id, email: user.email, error: createErr.message });
      console.error('[backfill-auth-users] failed for', user.email, createErr.message);
    }
  }

  return jsonResponse(200, {
    total: users.length,
    created,
    skipped,
    failed,
    failures,
  });
});
