/**
 * Module registry — the lookup table the shell uses to mount enabled
 * modules. Each entry describes a module's id (matches what the tenant
 * config's VITE_ENABLED_MODULES expects), nav label, route path, and a
 * lazy-loaded component factory.
 *
 * Adding a new module:
 *   1. Build it as its own package (e.g. eq-platform/packages/eq-quotes)
 *   2. Export a mountable component (e.g. QuotesModule)
 *   3. Add an entry below
 *
 * Modules NOT in the tenant's VITE_ENABLED_MODULES list don't render in
 * nav and their routes return null (with a "not enabled" message).
 */

import { lazy, type LazyExoticComponent, type ComponentType } from "react";

export interface ModuleDefinition {
  /** Stable ID — matches VITE_ENABLED_MODULES entries. */
  id: string;
  /** Display label in nav. */
  label: string;
  /** Route path inside the shell. */
  path: string;
  /**
   * Lazy-loaded component. Each module is rendered with no props (the shell
   * gives modules access to context — auth session, tenant config — via
   * React context, not props). Typed as `any` because module prop shapes
   * vary; the shell treats them as opaque mountable components.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: LazyExoticComponent<ComponentType<any>>;
}

export const MODULE_REGISTRY: ModuleDefinition[] = [
  {
    id: "intake",
    label: "Intake",
    path: "/intake",
    // Wrap the IntakeModule lazy import to inject the shell's Supabase
    // client + tenant ID. The module itself stays prop-based (testable in
    // isolation); the shell threads context-derived values in here.
    component: lazy(() =>
      import("./IntakeModuleHost.js").then((m) => ({ default: m.IntakeModuleHost })),
    ),
  },
  {
    id: "sites",
    label: "Sites",
    path: "/sites",
    // Canonical sites management — search, archive, delete against
    // app_data.sites in sks-canonical via SECURITY DEFINER RPCs (migration 021).
    component: lazy(() =>
      import("./SitesModuleHost.js").then((m) => ({ default: m.SitesModuleHost })),
    ),
  },
  {
    id: "quotes",
    label: "Quotes",
    path: "/quotes",
    // Stub for now — slot in @eq/quotes when it exists
    component: lazy(() =>
      import("./QuotesStub.js").then((m) => ({ default: m.QuotesStub })),
    ),
  },
  {
    id: "format",
    label: "EQ Format",
    path: "/format",
    // Sheet wrangler — map, validate, derive. Embeds the eq-format-ui dev
    // server via iframe. Start it with `pnpm -F @eq/format-ui dev`.
    // VITE_FORMAT_UI_URL controls the target (default: http://localhost:5174).
    component: lazy(() =>
      import("./FormatModuleHost.js").then((m) => ({ default: m.FormatModuleHost })),
    ),
  },
];

/** Modules the tenant has enabled, in nav order. */
export function enabledModules(enabledIds: string[]): ModuleDefinition[] {
  return enabledIds
    .map((id) => MODULE_REGISTRY.find((m) => m.id === id))
    .filter((m): m is ModuleDefinition => m !== undefined);
}
