// /totp-challenge — TOTP login step (Phase 1.G).
//
// Shown after shell-login returns { valid: true, requires_totp: true }.
// LoginPage navigates here with state: { totpChallengeToken: string }.
//
// The user types their 6-digit authenticator code; this page calls
// challenge-totp which verifies the code and issues the session cookie.
// On success, SessionContext.refresh() is called and the user is routed
// to their tenant home.
//
// Layout mirrors LoginPage's .eq-login-split shell so the two screens are
// visually consistent (same dark panel + white form card).

import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './auth.css';
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
  const [trustDevice, setTrustDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!token) {
    return (
      <TotpShell>
        <p className="eq-login-right__eyebrow">Two-step verification</p>
        <h2 className="eq-login-right__title">Something went wrong.</h2>
        <p className="eq-login-right__sub">
          Open this page from the sign-in form. Go back and sign in again.
        </p>
        <button
          type="button"
          className="eq-login-submit"
          onClick={() => navigate('/', { replace: true })}
        >
          Back to sign in
        </button>
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
        body: JSON.stringify({ totp_challenge_token: token, code, trust_device: trustDevice }),
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
      <p className="eq-login-right__eyebrow">Verify it's you</p>
      <h2 className="eq-login-right__title">Enter your code.</h2>
      <p className="eq-login-right__sub">
        Open your authenticator app and enter the 6-digit code for EQ Solutions.
      </p>

      <form onSubmit={onSubmit}>
        <div className="eq-login-field">
          <label htmlFor="totp-code" className="eq-login-label">Authenticator code</label>
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
            className="eq-login-input"
            style={{ letterSpacing: '0.3em', fontSize: 20, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
          />
        </div>

        <label className="eq-login-stay">
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
            disabled={busy}
          />
          Don't ask again on this device for 30 days
        </label>

        <button
          type="submit"
          className="eq-login-submit"
          disabled={busy || code.length !== 6}
        >
          {busy ? 'Verifying…' : 'Verify →'}
        </button>
      </form>

      {err && (
        <div className="eq-err" role="alert" style={{ marginTop: 16 }}>
          {err}
        </div>
      )}

      <p className="eq-login-foot">
        Lost access to your authenticator?{' '}
        <a href="mailto:support@eq.solutions">support@eq.solutions</a>
      </p>
    </TotpShell>
  );
}

function TotpShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="eq-login-page">
      <div className="eq-login-card-wrap">
        <div className="eq-login-split">

          {/* Dark left panel — same treatment as the sign-in screen. */}
          <div className="eq-login-left">
            <div className="eq-login-left__brand">
              <EqLogo size={28} variant="wordmark" onDark />
            </div>
            <p className="eq-login-left__eyebrow">Two-step verification</p>
            <h1 className="eq-login-left__heading">
              One more step.<br /><strong>Keep your account secure.</strong>
            </h1>
            <ul className="eq-login-left__apps">
              <li>Protects every EQ app</li>
              <li>Takes a few seconds</li>
            </ul>
          </div>

          {/* White right panel — form content. */}
          <div className="eq-login-right">
            {children}
          </div>
        </div>

        <p className="eq-login-page__copy">
          © EQ Solutions · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
