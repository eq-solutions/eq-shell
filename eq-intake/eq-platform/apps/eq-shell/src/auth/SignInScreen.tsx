/**
 * Sign-in screen. Email + password against Supabase Auth. Shown when
 * auth is enabled (VITE_SUPABASE_URL set) and no active session exists.
 *
 * First-tenant onboarding: the first user signs up through Supabase
 * directly (or you invite them via the Supabase dashboard). This screen
 * is sign-in only — no public sign-up button, since EQ tenants
 * onboard users intentionally, not via self-service.
 */

import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext.js";

export function SignInScreen({ tenantName }: { tenantName: string }): JSX.Element {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    setError(null);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) setError(error.message);
  };

  return (
    <div className="eq-signin">
      <div className="eq-signin__card">
        <header className="eq-signin__header">
          <h1>EQ</h1>
          <p>{tenantName}</p>
        </header>
        <form onSubmit={onSubmit} className="eq-signin__form">
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? (
            <div className="eq-signin__error" role="alert">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={busy || !email || !password}
            className="eq-signin__submit"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <footer className="eq-signin__footer">
          New user? Ask your EQ administrator to invite you via Supabase.
        </footer>
      </div>
    </div>
  );
}
