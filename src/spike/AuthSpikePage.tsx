/**
 * SPIKE - Auth re-platform spike route page.
 *
 * Mounted at /auth-spike (see App.tsx). This is a PUBLIC route (no
 * RequireSession wrap) so the live HMAC session is completely irrelevant
 * to this demo. The spike has its own independent Supabase Auth session.
 *
 * ISOLATION GUARANTEE:
 *   - This file imports ONLY from ./auth/* (spike internals).
 *   - It does not import from session.ts, supabase.ts, supabaseJwt.ts,
 *     permissions.ts, or any Netlify function.
 *   - The live auth path (SessionProvider, RequireSession, shell-login,
 *     verify-shell-session) is completely untouched.
 *   - If this file and the spike/ directory are deleted, the live app
 *     is 100% restored to its pre-spike state.
 */

import PasskeySpikeDemo from './auth/PasskeySpikeDemo';

export default function AuthSpikePage() {
  return <PasskeySpikeDemo />;
}