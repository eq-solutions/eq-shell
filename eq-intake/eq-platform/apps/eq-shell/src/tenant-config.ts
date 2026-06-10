/**
 * Per-tenant configuration. Reads from VITE_TENANT + VITE_TENANT_NAME +
 * VITE_ENABLED_MODULES at build time. Each Netlify deployment per tenant
 * sets these in its env config.
 *
 * The TENANT_PALETTES map adds per-tenant brand accents. SKS uses
 * dark-blue + purple per the CLAUDE.md brand notes. Future tenants get
 * added here when they sign up.
 */

export interface TenantConfig {
  /** Short key from VITE_TENANT. */
  key: string;
  /** Display name shown in the header. */
  name: string;
  /** Ordered list of module IDs to expose in nav. */
  enabledModules: string[];
  /** Brand palette overrides — applied as CSS custom properties on <html>. */
  palette: {
    primary: string;
    primaryDark: string;
    accent: string;
  };
}

const TENANT_PALETTES: Record<string, TenantConfig["palette"]> = {
  // SKS Technologies — per CLAUDE.md
  sks: {
    primary: "#1F335C",        // SKS dark blue
    primaryDark: "#15243F",
    accent: "#7C77B9",         // SKS purple
  },
  // Demo / default EQ palette
  demo: {
    primary: "#3DA8D8",        // EQ Sky
    primaryDark: "#2986B4",    // EQ Deep
    accent: "#7C77B9",
  },
};

function titleCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

export function readTenantConfig(): TenantConfig {
  const key = (import.meta.env.VITE_TENANT ?? "demo").trim().toLowerCase();
  const name = (import.meta.env.VITE_TENANT_NAME ?? titleCase(key)).trim();
  const modules = (import.meta.env.VITE_ENABLED_MODULES ?? "intake")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const palette = TENANT_PALETTES[key] ?? TENANT_PALETTES["demo"]!;
  return { key, name, enabledModules: modules, palette };
}

/**
 * Apply the tenant's palette as CSS custom properties on the document root.
 * Call once at app start so `var(--eq-primary)` etc. work everywhere.
 */
export function applyTenantPalette(palette: TenantConfig["palette"]): void {
  const root = document.documentElement;
  root.style.setProperty("--eq-primary", palette.primary);
  root.style.setProperty("--eq-primary-dark", palette.primaryDark);
  root.style.setProperty("--eq-accent", palette.accent);
}
