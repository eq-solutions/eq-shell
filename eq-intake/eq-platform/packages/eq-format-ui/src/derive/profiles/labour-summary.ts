/**
 * `labour-summary` profile — labour breakdown from a SimPRO-shaped quote.
 *
 * Filters to rows tagged Item Type = "Labour" and emits hours + cost/sell
 * rates per (section, cost-centre, description). Drops zero-hour /
 * zero-sell rows (placeholder labour entries with no actual time).
 *
 * Logic ported from `demos/simpro-quote-781/parse.mjs`. Useful inputs to
 * weekly-rollup payroll exports and capacity reporting.
 */

import type { DeriveProfile, DeriveOutput } from '../types';
import { num } from '../csv';

const COLUMNS = [
  'section',
  'cost_centre',
  'description',
  'hours',
  'unit_cost',
  'unit_sell',
  'line_total',
];

export const labourSummaryProfile: DeriveProfile = {
  id: 'labour-summary',
  label: 'Labour Summary',
  description:
    'Labour-line breakdown by section, cost centre, and description. Hours, unit cost, unit sell, line total. Drops zero-hour / zero-sell placeholder entries.',
  inputShape: 'simpro-quote',
  derive(rows: Record<string, unknown>[]): DeriveOutput {
    const labour = rows.filter((r) => String(r['Item Type'] ?? '') === 'Labour');

    const enriched = labour.map((l) => {
      const hours = num(l['Time (hrs)']);
      const unitCost = num(l['Labour Unit Cost Price']);
      const unitSell = num(l['Labour Unit Sell Price']);
      const lineTotal = num(l['Item Sell Price inc. Adjustments']) * hours;
      return {
        section: String(l['Section Name'] ?? ''),
        cost_centre: String(l['Cost Centre Name'] ?? ''),
        description: String(l['Part Description'] ?? ''),
        hours,
        unit_cost: unitCost.toFixed(2),
        unit_sell: unitSell.toFixed(2),
        line_total: lineTotal,
      };
    });

    // Drop placeholder rows (no hours, no sell rate). Real labour lines
    // always have at least one of the two.
    const filtered = enriched.filter(
      (l) => l.hours > 0 || num(l.unit_sell) > 0,
    );

    const out = filtered.map((l) => ({
      section: l.section,
      cost_centre: l.cost_centre,
      description: l.description,
      hours: l.hours,
      unit_cost: l.unit_cost,
      unit_sell: l.unit_sell,
      line_total: l.line_total.toFixed(2),
    }));

    return { columns: COLUMNS, rows: out };
  },
};
