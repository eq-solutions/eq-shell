/**
 * IntakeModuleHost — shell-side wrapper that injects the Supabase client +
 * tenant ID into @eq/intake-demo's IntakeModule.
 *
 * Keeps the module prop-based (so it stays testable in isolation) and
 * isolates the shell-specific wiring (getSupabase + env reads) here.
 */

import { IntakeModule } from "@eq/intake-demo";
import { getSupabase } from "../auth/supabase-client.js";

const TENANT_ID = (import.meta.env.VITE_TENANT_ID as string | undefined) ??
  "00000000-0000-4000-8000-000000000001";

export function IntakeModuleHost(): JSX.Element {
  const supabase = getSupabase();
  // The IntakeModule's SupabaseLikeClient type is structurally compatible
  // with the supabase-js SupabaseClient (it's a narrow subset); cast is
  // safe at the boundary. When null (no env), the module renders the
  // canonical section in disabled state.
  return (
    <IntakeModule
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase={supabase as any}
      tenantId={TENANT_ID}
    />
  );
}
