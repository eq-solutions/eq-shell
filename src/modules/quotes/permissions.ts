import type { EqRole } from '../../session';

export const QUOTES_PERMS = [
  'quotes.view',    // Access the Quotes module
  'quotes.create',  // Create new quotes
  'quotes.approve', // Approve a quote for submission / acceptance
] as const;

export type QuotesPermKey = (typeof QUOTES_PERMS)[number];

export const QUOTES_MATRIX: Record<EqRole, QuotesPermKey[]> = {
  manager:     ['quotes.view', 'quotes.create', 'quotes.approve'],
  supervisor:  ['quotes.view', 'quotes.create'],
  employee:    ['quotes.view'],
  apprentice:  [],
  labour_hire: [],
};
