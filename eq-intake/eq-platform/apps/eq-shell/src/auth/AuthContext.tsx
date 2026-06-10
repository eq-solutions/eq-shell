/**
 * Auth context — wraps the app, exposes the current Supabase session
 * (or null in no-auth dev mode), provides sign-in / sign-out helpers.
 *
 * When VITE_SUPABASE_URL is unset, the context renders children
 * directly without gating — useful for local dev without a Supabase
 * project provisioned yet.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, AuthError } from "@supabase/supabase-js";
import { getSupabase, isAuthEnabled } from "./supabase-client.js";

interface AuthContextShape {
  /** True until the initial session check finishes. */
  loading: boolean;
  /** Active session, or null when signed out / no-auth mode. */
  session: Session | null;
  /** True when Supabase is configured. False = no-auth dev mode. */
  authEnabled: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextShape | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const authEnabled = isAuthEnabled();
  const supabase = getSupabase();

  const [loading, setLoading] = useState<boolean>(authEnabled);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return { error: null };
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error };
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ loading, session, authEnabled, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextShape {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
