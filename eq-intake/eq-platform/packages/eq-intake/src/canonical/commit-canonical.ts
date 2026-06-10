/**
 * @eq/intake — Supabase client type stub
 *
 * The full commit-canonical implementation lives in @eq/intake-demo.
 * This file re-exports only the structural SupabaseLikeClient interface
 * so that tidy-pass.ts, orphan-check.ts, and the quality modules can
 * type-check without taking a hard dependency on @supabase/supabase-js.
 */

// ---------------------------------------------------------------------------
// Structural Supabase client type
// Callers (eq-service, edge functions) pass their real Supabase client —
// this interface only describes the subset used by the tidy/quality modules.
// ---------------------------------------------------------------------------

export interface SupabaseLikeClient {
  from: (table: string) => {
    insert: (row: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
    update: (row: unknown) => {
      eq: (
        col: string,
        val: unknown,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    select: (cols?: string) => {
      eq: (col: string, val: unknown) => Promise<{ data: unknown[]; error: { message: string } | null }>;
      gte: (col: string, val: unknown) => {
        lte: (col: string, val: unknown) => Promise<{ data: unknown[]; error: { message: string } | null }>;
      };
    };
  };
  rpc: (
    name: string,
    params?: unknown,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
}
