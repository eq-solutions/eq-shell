// Quote taxonomy — the single source of truth for status slugs, status groups,
// line-item categories, and the cross-system maps from the legacy Flask app
// (eq-quotes-port) to EQ Ops.
//
// Locking these "in writing" is accuracy risk #2 from the EQ Ops <-> Flask gap
// matrix: reports, documents, AI grounding and any historical data migration must
// agree on exactly these strings. EQ Ops stores status as kebab-case slugs and
// categories as singular keys. taxonomy.test.ts locks completeness + the maps, so
// the copies that still live in QuotesReports / QuotesCustomers can't silently
// drift from these without a red test.

/** Every quote status slug EQ Ops can store, in pipeline order. */
export const QUOTE_STATUSES = [
  "draft", "submitted", "client-reviewing", "on-hold",
  "verbal-win", "won-awaiting-job-no", "won-job-created", "po-matched",
  "active", "complete", "ready-to-invoice", "invoiced",
  "lost", "cancelled", "expired", "superseded",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Canonical long-form labels (the detail + pipeline display set). Compact
 *  labels for the dense customer view live in QuotesCustomers on purpose. */
export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  "client-reviewing": "Client Reviewing",
  "on-hold": "On Hold",
  "verbal-win": "Verbal Win",
  "won-awaiting-job-no": "Won — Awaiting Job No.",
  "won-job-created": "Won — Job Created",
  "po-matched": "PO Matched",
  active: "Active",
  complete: "Complete",
  "ready-to-invoice": "Ready to Invoice",
  invoiced: "Invoiced",
  lost: "Lost",
  cancelled: "Cancelled",
  expired: "Expired",
  superseded: "Superseded",
};

// Status groups — documented semantics, every member a valid QUOTE_STATUS.
// WON_EVER / CLOSED_LOST / OPEN_PIPELINE partition all 15 statuses; ACTIVE_JOB is
// a subset of WON_EVER. Typed as ReadonlySet<string> so `.has(quote.status)`
// (status is a plain string off the wire) stays ergonomic at call sites.

/** Live/won job currently in the pipeline — drives the pipeline win count and
 *  the "Active Jobs" view. Excludes complete + ready-to-invoice (finished, not
 *  active). */
export const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set<string>([
  "verbal-win", "won-awaiting-job-no", "won-job-created", "po-matched", "active",
]);

/** Ever-accepted, including finished jobs — the reports win-rate numerator. */
export const WON_EVER_STATUSES: ReadonlySet<string> = new Set<string>([
  ...ACTIVE_JOB_STATUSES, "complete", "ready-to-invoice", "invoiced",
]);

/** End-of-life, not won — the reports loss bucket. */
export const CLOSED_LOST_STATUSES: ReadonlySet<string> = new Set<string>([
  "lost", "cancelled", "expired", "superseded",
]);

/** Still being worked — not yet won or lost. */
export const OPEN_PIPELINE_STATUSES: ReadonlySet<string> = new Set<string>([
  "draft", "submitted", "client-reviewing", "on-hold",
]);

/** The four fixed line-item sections. EQ Ops stores singular keys; the section
 *  IS the category (no per-row dropdown). */
export const QUOTE_CATEGORIES = ["labour", "material", "subcontractor", "one_off"] as const;
export type QuoteCategory = (typeof QUOTE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  labour: "Labour",
  material: "Materials",
  subcontractor: "Subcontractors",
  one_off: "One-off",
};

// ── Cross-system maps: legacy Flask (eq-quotes-port) → EQ Ops ────────────────
// Source of truth for the Flask side: app/quotes/status.py STATUSES (9 values).
// EQ-Ops-only statuses (po-matched, active, complete, ready-to-invoice, expired,
// superseded) have no Flask origin — they are the post-win job lifecycle + auto
// expiry + revision states Flask never modelled.

/** Flask status string → EQ Ops slug. "Withdrawn" has no EQ equivalent and folds
 *  into "cancelled" (both are a deliberate, one-way end-of-life). "Sent" is the
 *  legacy Flask UI label for a submitted quote. */
export const FLASK_STATUS_TO_EQ: Record<string, string> = {
  "Draft": "draft",
  "Submitted": "submitted",
  "Sent": "submitted",
  "Client Reviewing": "client-reviewing",
  "On Hold": "on-hold",
  "Verbal Win": "verbal-win",
  "Won-Awaiting Job No": "won-awaiting-job-no",
  "Won-Job Created": "won-job-created",
  "Lost": "lost",
  "Withdrawn": "cancelled",
};

/** Flask line-item category string → EQ Ops category key. Covers the spelling
 *  variants seen in the Flask data (materials/material, subcon/subcontractors,
 *  oneoff/one_off). */
export const FLASK_CATEGORY_TO_EQ: Record<string, string> = {
  labour: "labour",
  material: "material",
  materials: "material",
  subcon: "subcontractor",
  subcontractor: "subcontractor",
  subcontractors: "subcontractor",
  one_off: "one_off",
  oneoff: "one_off",
};
