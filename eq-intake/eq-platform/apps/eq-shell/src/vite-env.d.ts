/// <reference types="vite/client" />

/**
 * Per-tenant configuration via env vars.
 *
 * VITE_TENANT       — short tenant key (e.g. "sks", "demo"). Drives brand
 *                     palette + display name in the header.
 * VITE_TENANT_NAME  — long display name (e.g. "SKS Technologies"). Falls
 *                     back to a title-cased VITE_TENANT.
 * VITE_ENABLED_MODULES — comma-separated module IDs (e.g.
 *                        "intake,quotes,field"). Order = nav order.
 *
 * VITE_SUPABASE_URL — auth + canonical (per-tenant Supabase project URL)
 * VITE_SUPABASE_ANON_KEY — public anon key for the Supabase client
 *
 * VITE_ANTHROPIC_API_KEY — optional, passed through to Intake module
 *                          (mock AI by default). See eq-intake-demo README.
 */
interface ImportMetaEnv {
  readonly VITE_TENANT?: string;
  readonly VITE_TENANT_NAME?: string;
  readonly VITE_ENABLED_MODULES?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
