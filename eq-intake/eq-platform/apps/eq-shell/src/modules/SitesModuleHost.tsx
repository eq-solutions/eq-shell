/**
 * SitesModuleHost — shell-side wrapper that injects the Supabase client
 * into the SitesModule.
 *
 * Mirrors the IntakeModuleHost pattern: keeps the module prop-based and
 * isolates the shell-specific wiring here.
 */

import { SitesModule } from "./sites/SitesModule.js";
import { getSupabase } from "../auth/supabase-client.js";

export function SitesModuleHost(): JSX.Element {
  const supabase = getSupabase();
  return <SitesModule supabase={supabase} />;
}
