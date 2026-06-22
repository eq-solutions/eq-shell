// Field tenant configuration — single source of truth for the Shell side.
//
// The Netlify function (netlify/functions/token-exchange.ts) maintains
// its own ALLOWED_FIELD_TENANT_SLUGS allow-list. When adding a new Field
// org, update BOTH that constant AND this file in the same PR.
//
// COOKIE AUTH MODE
// When VITE_FIELD_URL=https://field.eq.solutions, the eq_shell_session cookie
// (Domain=.eq.solutions) is sent automatically to field.eq.solutions. Field's
// verify-pin.js reads it directly — no token minting needed.
//
// SKS routes to eq-field.netlify.app (the unified EQ Field codebase) with
// ?tenant=sks. This host is not on .eq.solutions, so it uses token auth — Shell
// mints a short-lived JWT via token-exchange and passes it in the #sh= hash.
// field.sks.eq.solutions and sks-nsw-labour.netlify.app are both retired.

const FIELD_BASE_URL = (import.meta.env.VITE_FIELD_URL as string | undefined)
  ?? 'https://eq-field.netlify.app/';

export const FIELD_TENANT_URLS: Record<string, string> = {
  eq: FIELD_BASE_URL,
  'demo-trades': FIELD_BASE_URL,
  melbourne: FIELD_BASE_URL,
  // SKS is hardcoded — must NOT inherit VITE_FIELD_URL (which points to field.eq.solutions,
  // a cookie-auth domain). Token auth via #sh= requires a non-.eq.solutions host.
  sks: 'https://eq-field.netlify.app/',
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

/** True when the tenant's Field deploy is on eq.solutions and can use cookie auth. */
export function tenantUsesCookieAuth(tenantSlug: string): boolean {
  const base = FIELD_TENANT_URLS[tenantSlug] ?? FIELD_BASE_URL;
  return base.includes('.eq.solutions');
}

/** Build the iframe src for token-based auth (legacy / SKS). The optional
 *  correlation id rides ALONGSIDE the signed #sh= handoff (never inside the
 *  signed payload) so Field can tag the same `cid` on its Sentry events — see
 *  eq-context/cross-repo-contracts. */
export function buildFieldSrc(tenantSlug: string, token: string, cid?: string): string {
  const base = FIELD_TENANT_URLS[tenantSlug] ?? FIELD_BASE_URL;
  const hash = cid
    ? `#sh=${encodeURIComponent(token)}&cid=${encodeURIComponent(cid)}`
    : `#sh=${encodeURIComponent(token)}`;
  return `${base}?tenant=${encodeURIComponent(tenantSlug)}${hash}`;
}

/** Build the iframe src for cookie-based auth (eq.solutions tenants). cid (when
 *  present) rides as a query param — cookie mode has no #sh= hash, and Field
 *  reads `cid` from the query OR the hash. */
export function buildFieldCookieSrc(tenantSlug: string, cid?: string): string {
  const base = FIELD_TENANT_URLS[tenantSlug] ?? FIELD_BASE_URL;
  const cidPart = cid ? `&cid=${encodeURIComponent(cid)}` : '';
  return `${base}?tenant=${encodeURIComponent(tenantSlug)}&shell=1${cidPart}`;
}
