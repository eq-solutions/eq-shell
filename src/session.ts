// Shared types + React context for the EQ Shell session.
//
// The session is hydrated by calling /.netlify/functions/verify-shell-session
// on mount; the function reads the eq_shell_session cookie and returns
// the canonical user/tenant/entitlements triple. Login sets the cookie
// out-of-band (Set-Cookie header), so the same hydrator runs after login.

import { createContext, useContext } from 'react';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  brand_color: string | null;
  brand_logo_url: string | null;
  active: boolean;
}

export interface User {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
  active: boolean;
  last_login_at: string | null;
}

export interface Entitlement {
  module: string;
  enabled: boolean;
}

export interface ShellSession {
  user: User;
  tenant: Tenant;
  entitlements: Entitlement[];
}

export interface SessionContextValue {
  session: ShellSession | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
}

export const SessionContext = createContext<SessionContextValue>({
  session: null,
  loading: true,
  refresh: async () => {},
  logout: () => {},
});

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export function moduleEnabled(session: ShellSession | null, module: string): boolean {
  if (!session) return false;
  return session.entitlements.some((e) => e.module === module && e.enabled);
}
