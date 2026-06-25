/**
 * @eq/intake — Edge Function caller for AI-powered quality features
 *
 * The Anthropic API key is stored as a Supabase secret on sks-canonical
 * (ehowgjardagevnrluult) — never exposed to the browser. All AI calls go
 * through the `eq-ai-assist` Edge Function.
 *
 * The caller is injected rather than hardwired so:
 *   a) library code stays free of transport details
 *   b) the demo can wire it up from supabase.functions.invoke()
 *   c) tests can stub it without network access
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The shape of a response from the eq-ai-assist Edge Function. */
export interface EdgeFnResponse {
  data: unknown;
  error: { message: string } | null;
}

/**
 * Caller injected by the host app.
 * In the demo: (action, payload) => supabase.functions.invoke('eq-ai-assist', { body: { action, ...payload } })
 */
export type EdgeFnCaller = (
  action: string,
  payload: Record<string, unknown>,
) => Promise<EdgeFnResponse>;

/**
 * Build an EdgeFnCaller from a Supabase client that has functions.invoke().
 * Use this in the demo/shell rather than calling supabase.functions directly.
 */
export function makeEdgeFnCaller(
  // Accept `any` here — the supabase-js type is not available in this package
  // and we don't want to add it as a dep just for the type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => Promise<EdgeFnResponse> } },
): EdgeFnCaller {
  return (action, payload) =>
    supabase.functions.invoke('eq-ai-assist', { body: { action, ...payload } });
}
