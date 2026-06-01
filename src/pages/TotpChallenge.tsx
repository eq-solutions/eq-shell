// /totp-challenge — TOTP login step (Phase 1.G).
//
// Shown after shell-login returns { valid: true, requires_totp: true }.
// LoginPage navigates here with state: { totpChallengeToken: string }.
//
// The user types their 6-digit authenticator code; this page calls
// challenge-totp which verifies the code and issues the session cookie.
// On success, SessionContext.refresh() is called and the user is routed
// to their tenant home.

import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './auth.css';
import { Button } from '@eq-solutions/ui';
import { useSession } from '../session';
import { EqLogo } from '../components/EqLogo';

export default function TotpChallenge() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useSession();

  // Token is passed via router state from LoginPage.
  const state = location.state as { totpChallengeToken?: string; redirectTo?: string } | null;
  const token = state?.totpChallengeToken ?? '';
  const redirectTo = state?.redirectTo;

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!token) {
    return (
      <TotpShell>
        <h2>Something went wrong</h2>
        <p className="lede">
          Open this page directly from the sign-in form. Go back and sign in again.
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={() => navigate('/login', { replace: true })}
        >
          Back to sign in
        </Button>
      </TotpShell>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setErr('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch('/.netlify/functions/challenge-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ totp_challenge_token: token, code }),
      });
      const body = (await res.json()) as { valid: boolean };
      if (!body.valid) {
        setErr('That code is wrong or has expired. Try again.');
        setBusy(false);
        return;
      }
      await refresh();
      navigate(redirectTo ?? '/', { replace: true });
    } catch {
      setErr('Network error — check your connection and try again.');
      setBusy(false);
    }
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Accept only digits; strip anything else as the user types.
    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    if (err) setErr(null);
  }

  return (
    <TotpShell>
      <form className="eq-login-form" onSubmit={onSubmit}>
        <h2>Two-step verification</h2>
        <p className="lede">
          Open your authenticator app and enter the 6-digit code for EQ Solutions.
        </p>
        <label htmlFor="totp-code">Authenticator code</label>
        <input
          id="totp-code"
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={6}
          value={code}
          onChange={handleCodeChange}
          disabled={busy}
          placeholder="000000"
          style={{ letterSpacing: '0.2em', fontSize: 22, textAlign: 'center' }}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={busy || code.length !== 6}
          style={{ width: '100%' }}
        >
          {busy ? 'Verifying…' : 'Verify →'}
        </Button>
        {err && (
          <div className="eq-err" role="alert">
            {err}
          </div>
        )}
        <p className="eq-login-form__foot">
          Lost access to your authenticator?{' '}
          <a href="mailto:support@eq.solutions">support@eq.solutions</a>
        </p>
      </form>
    </TotpShell>
  );
}

function TotpShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="eq-login-page">
      <aside className="eq-login-hero">
        <header className="eq-login-hero__top">
          <EqLogo size={32} onDark variant="wordmark" />
        </header>
        <div className="eq-login-hero__main">
          <span className="eq-login-hero__eyebrow">
            <span className="eq-login-hero__eyebrow-dot" />
            SECURE · TWO-STEP VERIFICATION
          </span>
          <h1 className="eq-login-hero__headline">
            One more step to keep your account{' '}
            <span className="eq-login-hero__accent">secure</span>.
          </h1>
          <p className="eq-login-hero__sub">
            Your account is protected with two-step verification. Enter the
            code from your authenticator app to continue.
          </p>
        </div>
        <footer className="eq-login-hero__foot">
          © EQ Solutions · {new Date().getFullYear()} · 2FA
        </footer>
      </aside>
      <div className="eq-login-form-wrap">{children}</div>
    </div>
  );
}
