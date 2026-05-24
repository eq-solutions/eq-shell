// Field tenant configuration — single source of truth for the Shell side.
//
// The Netlify function (netlify/functions/mint-iframe-token.ts) maintains
// its own ALLOWED_FIELD_TENANT_SLUGS allow-list. When adding a new Field
// org, update BOTH that constant AND this file in the same PR.

export const FIELD_TENANT_URLS: Record<string, string> = {
  eq: 'https://eq-solves-field.netlify.app/',
  'demo-trades': 'https://eq-solves-field.netlify.app/',
  melbourne: 'https://eq-solves-field.netlify.app/',
  sks: 'https://sks-nsw-labour.netlify.app/',
};

export const TENANT_OPTIONS = [
  {
    slug: 'sks',
    tier: 'Live',
    name: 'SKS Technologies',
    tagline: 'Production workforce — SKS NSW.',
  },
  {
    slug: 'eq',
    tier: 'Standard',
    name: 'EQ Demo',
    tagline: 'SEED data, unchanged UI. The "before" baseline.',
  },
  {
    slug: 'demo-trades',
    tier: 'Advanced',
    name: 'Demo Trades',
    tagline: 'Adds Projects, Employment filter, People-form fields.',
  },
  {
    slug: 'melbourne',
    tier: 'Enterprise',
    name: 'Melbourne',
    tagline: 'Full surface: Forecast, Apprentice ratio, Region picker.',
  },
] as const;

export type TenantOption = (typeof TENANT_OPTIONS)[number];
export type TenantSlug = TenantOption['slug'];

export function buildFieldSrc(tenantSlug: string, token: string): string {
  const base = FIELD_TENANT_URLS[tenantSlug] ?? 'https://eq-solves-field.netlify.app/';
  return `${base}?tenant=${encodeURIComponent(tenantSlug)}#sh=${encodeURIComponent(token)}`;
}
