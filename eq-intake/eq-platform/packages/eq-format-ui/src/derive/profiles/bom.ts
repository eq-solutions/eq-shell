/**
 * `bom` profile — Bill of Materials from a SimPRO-shaped quote export.
 *
 * Takes raw SimPRO quote rows and emits a procurement-ready material list:
 * one row per (Section, Cost Centre, Description, Part Number) with summed
 * quantities and reconciled cost/sell totals. Labour rows are excluded —
 * they're handled by the `labour-summary` profile.
 *
 * Logic ported from `demos/simpro-quote-781/parse.mjs`. Subtotals reconcile
 * against the SimPRO Cost Centre Subtotal column on the source export.
 */

import type { DeriveProfile, DeriveOutput } from '../types';
import { num } from '../csv';

const COLUMNS = [
  'section',
  'cost_centre',
  'part_number',
  'description',
  'uom',
  'quantity',
  'unit_cost',
  'unit_sell',
  'total_cost',
  'total_sell',
];

interface BomGroup {
  section: string;
  cost_centre: string;
  part_number: string;
  description: string;
  uom: string;
  quantity: number;
  unit_cost: number;
  unit_sell: number;
  total_cost: number;
  total_sell: number;
}

const bomKey = (m: Record<string, unknown>): string =>
  `${m['Section Name'] ?? ''}|${m['Cost Centre Name'] ?? ''}|${m['Part Description'] ?? ''}|${m['Part Number'] ?? ''}`;

export const bomProfile: DeriveProfile = {
  id: 'bom',
  label: 'Bill of Materials',
  description:
    'Procurement-ready material list grouped by section, cost centre, and part. Summed quantities; reconciled cost and sell totals. Labour excluded.',
  inputShape: 'simpro-quote',
  derive(rows: Record<string, unknown>[]): DeriveOutput {
    // Filter to material rows (drop Labour, drop blank rows). SimPRO Item
    // Type values that count as materials: "One off Item" and "Prebuild".
    const materials = rows.filter((r) => {
      const t = String(r['Item Type'] ?? '');
      return t === 'One off Item' || t === 'Prebuild';
    });

    const groups = new Map<string, BomGroup>();
    for (const m of materials) {
      const k = bomKey(m);
      const qty = num(m['Quantity']);
      const unitSell = num(m['Item Sell Price']);
      const unitCost = num(m['Material Unit Cost Price']);
      const existing = groups.get(k);
      if (existing) {
        existing.quantity += qty;
        existing.total_cost += qty * unitCost;
        existing.total_sell += qty * unitSell;
      } else {
        groups.set(k, {
          section: String(m['Section Name'] ?? ''),
          cost_centre: String(m['Cost Centre Name'] ?? ''),
          part_number: String(m['Part Number'] ?? ''),
          description: String(m['Part Description'] ?? ''),
          uom: String(m['Unit Of Measurement'] ?? '') || 'ea',
          quantity: qty,
          unit_cost: unitCost,
          unit_sell: unitSell,
          total_cost: qty * unitCost,
          total_sell: qty * unitSell,
        });
      }
    }

    const sorted = [...groups.values()].sort((a, b) =>
      (a.section + a.cost_centre).localeCompare(b.section + b.cost_centre),
    );

    const outRows = sorted.map((g) => ({
      section: g.section,
      cost_centre: g.cost_centre,
      part_number: g.part_number,
      description: g.description,
      uom: g.uom,
      quantity: g.quantity,
      unit_cost: g.unit_cost.toFixed(2),
      unit_sell: g.unit_sell.toFixed(2),
      total_cost: g.total_cost.toFixed(2),
      total_sell: g.total_sell.toFixed(2),
    }));

    return { columns: COLUMNS, rows: outRows };
  },
};
