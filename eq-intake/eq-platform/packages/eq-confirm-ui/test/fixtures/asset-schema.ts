/**
 * Compact asset schema for confirm-flow acceptance tests. Mirrors the relevant
 * shape of eq-schemas/asset.schema.json — name required, site_id is a fuzzy-
 * matchable FK, asset_type/criticality enums, ppm_frequency free text.
 */
export const ASSET_SCHEMA: Record<string, unknown> = {
  $id: "https://schemas.eq.solutions/test/asset-minimal.json",
  type: "object",
  "x-eq-entity": "asset",
  properties: {
    asset_id: { type: "string", format: "uuid", "x-eq-system-managed": true },
    site_id: {
      type: ["string", "null"],
      format: "uuid",
      "x-eq-foreign-key": "site.site_id",
      "x-eq-fk-fuzzy-match-on": ["site.name", "site.code", "site.external_id"],
    },
    external_id: { type: ["string", "null"], maxLength: 64 },
    name: { type: "string", maxLength: 200 },
    make: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    serial_number: { type: ["string", "null"] },
    asset_type: {
      type: "string",
      enum: ["switchboard", "ups", "generator", "transformer", "other"],
      "x-eq-suggested-values": ["switchboard", "ups", "generator", "transformer", "other"],
    },
    criticality: {
      type: "string",
      enum: ["critical", "high", "medium", "low"],
    },
    ppm_frequency: { type: ["string", "null"], maxLength: 100 },
    active: { type: "boolean", "x-eq-coerce": "boolean", default: true },
  },
  required: ["name"],
};
