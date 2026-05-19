/**
 * Shared types for the derive (reshape-out) profile system.
 *
 * Each derive profile takes a set of input rows in a known shape and emits
 * a tabular result: a list of column names plus rows keyed by those columns.
 * Profiles are registered in `registry.ts`. The HTTP surface in
 * `../server.ts` dispatches to a profile by id.
 */

/**
 * What shape of input rows a profile expects.
 *
 * - `simpro-quote` — raw rows parsed from a SimPRO quote CSV. Columns are
 *   the SimPRO quote schema (Section Name, Cost Centre Name, Item Type,
 *   Part Number, Part Description, Quantity, Time (hrs), Labour Unit Cost
 *   Price, Material Unit Cost Price, Item Sell Price, etc).
 * - `canonical` — rows that have already been mapped + validated to a
 *   canonical EQ schema (asset, staff, etc). Rows are
 *   `ValidationResult.valid_rows[N].canonical`.
 * - `raw` — any tabular shape; profile is responsible for understanding
 *   the columns it gets.
 *
 * Future profiles can extend this union as new input contracts emerge.
 */
export type DeriveInputShape = 'simpro-quote' | 'canonical' | 'raw';

/** Result of a derive call: a 2D table the caller can render or stream as CSV. */
export interface DeriveOutput {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** A registered reshape-out target. */
export interface DeriveProfile {
  /** Stable id used in the API request body and the derive registry. */
  id: string;
  /** Short human-readable label for UI surfaces (download buttons, menus). */
  label: string;
  /** One-line description of what this profile produces. */
  description: string;
  /** What shape of rows this profile expects as input. Documented and enforced. */
  inputShape: DeriveInputShape;
  /** Pure transform from input rows to output table. No I/O. */
  derive(rows: Record<string, unknown>[]): DeriveOutput;
}
