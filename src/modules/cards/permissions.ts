import type { EqRole } from '../../session';

export const CARDS_PERMS = [
  'cards.view',    // Access the Cards module
  'cards.onboard', // Submit a new staff onboarding card
] as const;

export type CardsPermKey = (typeof CARDS_PERMS)[number];

export const CARDS_MATRIX: Record<EqRole, CardsPermKey[]> = {
  manager:     ['cards.view', 'cards.onboard'],
  supervisor:  ['cards.view', 'cards.onboard'],
  employee:    ['cards.view'],
  apprentice:  ['cards.view'],
  labour_hire: [],
};
