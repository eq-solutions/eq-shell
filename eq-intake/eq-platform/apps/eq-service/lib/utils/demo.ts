/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * Demo-mode helpers. The demo user and tenant are public fixtures
 * advertised on the signin page and at /demo, so credentials are not
 * secret — they are hardcoded here intentionally.
 */

export const DEMO_EMAIL = 'demo@eqsolves.com.au'
export const DEMO_PASSWORD = 'demo1234'
export const DEMO_TENANT_ID = 'a0000000-0000-0000-0000-000000000001'

export function isDemoEmail(email: string | null | undefined): boolean {
  return email?.toLowerCase() === DEMO_EMAIL
}
