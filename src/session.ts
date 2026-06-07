// Shared types + React context for the EQ Shell session.
//
// The session is hydrated by calling /.netlify/functions/verify-shell-session
// on mount; the function reads the eq_shell_session cookie and returns
// the canonical user/tenant/entitlements triple. Login sets the cookie
// out-of-band (Set-Cookie header), so the same hydrator runs after login.

import { createContext, useContext } from 'react';
import type { EqRole } from '@eq-solutions/roles';

// Re-export so every module that imports EqRole from './session' keeps working.
export type { EqRole };

export type EqTier = 'trial' | 'standard' | 'advanced' | 'enterprise';

/** Per-tenant runtime config — mirrors TenantConfig in netlify/functions/_shared/token.ts. */
export interface TenantConfig {
  feature_flags: Record<string, Record<string, unknown>>;
  field_settings: {
    timezone: string;
    currency: string;
    week_start: 'monday' | 'sunday';
  };
}

export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  feature_flags: {},
  field_settings: { timezone: 'Australia/Sydney', currency: 'AUD', week_start: 'monday' },
};

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  brand_color: string | null;
  brand_logo_url: string | null;
  field_tenant_slug: string | null;
  tier: EqTier;
  active: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  tenant_id: string;
  role: EqRole;
  /**
   * Phase 1.F: EQ Solutions internal cross-tenant flag. When true, the
   * shell's useCan() helper short-circuits to true for any permission.
   * Only set on EQ-internal users (Royce, support staff). Single audit
   * point for "this user can do this across every tenant."
   */
  is_platform_admin: boolean;
  active: boolean;
  last_login_at: string | null;
  /**
   * Extra permission keys granted via security groups + tenant role grants
   * (optional — absent for users with neither). Populated by verify-shell-session.
   */
  extra_perms?: string[];
  /**
   * Permission keys explicitly denied by tenant role overrides. Populated
   * by verify-shell-session. Takes precedence over role defaults + extra_perms.
   */
  denied_perms?: string[];
}

export interface Entitlement {
  module: string;
  enabled: boolean;
}

export interface Membership {
  tenant_id: string;
  role: EqRole;
  tenant_slug?: string;
  tenant_name?: string;
}

export interface ShellSession {
  user: User;
  tenant: Tenant;
  entitlements: Entitlement[];
  /**
   * All active memberships this user has. UI uses length > 1 to decide
   * whether to render the workspace switcher. Always at least the
   * currently-active membership.
   */
  memberships: Membership[];
  /**
   * Supabase-format JWT signed by the shell-login / verify-shell-session
   * functions. Used to construct a browser Supabase client that talks
   * directly to the eq-canonical project with tenant scope enforced by
   * RLS. Re-issued (1h TTL) on every verify-shell-session call.
   */
  supabase_jwt: string;
  /** Per-tenant runtime config. Always present; pre-provisioning responses default to DEFAULT_TENANT_CONFIG. */
  config: TenantConfig;
  /**
   * When true, this user must set up a second sign-in step before using
   * the app — a manager/supervisor/platform-admin past their 14-day
   * grace runway who hasn't enrolled TOTP yet. The shell routes them to
   * /settings/2fa and holds them there until they enrol. Re-evaluated by
   * verify-shell-session on every mount, so it clears as soon as they do.
   */
  requires_totp_enrollment?: boolean;
}

export interface SessionContextValue {
  session: ShellSession | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue>({
  session: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export function moduleEnabled(session: ShellSession | null, module: string): boolean {
  if (!session) return false;
  return session.entitlements.some((e) => e.module === module && e.enabled);
}