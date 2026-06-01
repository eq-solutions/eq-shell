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
   * Extra permission keys granted via security groups (optional — absent
   * for users with no group membership). Populated by verify-shell-session.
   */
  extra_perms?: string[];
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