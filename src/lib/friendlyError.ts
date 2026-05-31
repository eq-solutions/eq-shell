// Turns any thrown/returned error into plain-English copy that is safe to show
// a user. Raw Supabase / PostgREST / Netlify-function error strings (and any
// stringified DB rows) are internal: they confuse non-technical users and can
// leak schema, function, or column names. Never render them directly — pass the
// error through here with a context-specific fallback.

const GENERIC =
  'Something went wrong. Please try again, or contact support if it keeps happening.';

export function friendlyError(e: unknown, fallback: string = GENERIC): string {
  // Keep the raw error visible to developers without ever putting it on screen.
  if (import.meta.env?.DEV) console.error('[friendlyError]', e);

  // The one raw signal worth translating: a fetch that never reached the server.
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) {
    return "We couldn't reach the server. Check your connection and try again.";
  }

  return fallback;
}
