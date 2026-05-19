/**
 * Package barrel — exposes the mountable Intake module + its supporting
 * pieces so the EQ Shell (or any other host React app) can mount Intake
 * as a lazy-loaded route.
 *
 * The demo's standalone `App.tsx` still works (run `pnpm dev` to get
 * the same playground at localhost:5174). That's for development. The
 * production deployment lives inside the shell, which imports from
 * here.
 */

// The Intake module entry-point. Mount this at /intake inside any host app.
export { IntakeModule } from "./module/IntakeModule.js";
export type { IntakeModuleProps } from "./module/IntakeModule.js";

// Lower-level pieces, re-exported in case a host wants to compose its own
// arrangement (e.g. embed just the bundle flow without the tabs).
export { RollupDropZone } from "./rollup/RollupDropZone.js";
export { renderTemplate, renderToCsv } from "./rollup/template.js";
export type {
  DestinationTemplate,
  TemplateColumn,
  TemplateRenderResult,
  TemplateRenderOptions,
} from "./rollup/template.js";
export { BUILTIN_TEMPLATES, buildUserTemplate } from "./rollup/templates.js";

// Schemas — useful for host apps wiring their own classifier registry.
export { CUSTOMER_SCHEMA, CONTACT_SCHEMA, SITE_SCHEMA } from "./simpro-schemas.js";

// AI picker — host can override if they want their own provider.
export { pickAi } from "./ai-picker.js";
export type { PickedAi } from "./ai-picker.js";
