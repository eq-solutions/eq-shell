// Public landing page for PIN reset.
// Reads ?token= from URL, asks for new PIN, POSTs to accept-pin-reset.
// No session required — the token is the authentication.

import { useState, type FormEvent } from 'react';
import './auth.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../session';
import { EqLogo } from '../components/EqLogo';

export default function ResetPin() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    if (pin !== pinConfirm) {
      setErr('PINs do not match — re-enter to confirm.');
      return;
    }
    if (pin.length < 4) {
      setErr('PIN must be at least 4 characters.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/.netlify/functions/accept-pin-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reset_token: token, pin }),
      });
      const body = (await res.json()) as
        | { valid: true; tenant: { slug: string } }
        | { valid: false; error?: string };

      if (!body.valid) {
        const map: Record<string, string> = {
          'invalid-reset': 'This link has expired or already been used. Ask your manager for a new one.',
          'token-not-found-or-expired': 'This link has expired or already been used. Ask your manager for a new one.',
          'bad-pin': 'PIN must be 4–12 letters or digits.',
          'invalid-pin': 'PIN must be 4–12 letters or digits.',
          'bad-request': 'Something went wrong — try again.',
          'server-misconfigured': 'Server error — contact your administrator.',
        };
        setErr(map[body.error ?? ''] ?? 'Could not reset PIN. Try again or ask your manager.');
        setBusy(false);
        return;
      }

      await refresh();
      navigate(`/${body.tenant.slug}`, { replace: true });
    } catch {
      setErr('Network error — please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="eq-login-page">
      <div className="eq-login-card-wrap">
        <div className="eq-login-split">

          {/* Dark left panel */}
          <div className="eq-login-left">
            <div className="eq-login-left__brand">
              <EqLogo size={28} variant="wordmark" onDark />
            </div>
            <p className="eq-login-left__eyebrow">EQ Solutions</p>
            <h1 className="eq-login-left__heading">
              Set a new <strong>PIN.</strong>
            </h1>
            <ul className="eq-login-left__apps">
              <li>One PIN for every tool</li>
              <li>4–12 letters or digits</li>
              <li>Takes effect immediately</li>
            </ul>
          </div>

          {/* White right panel */}
          <div className="eq-login-right">
            {!token ? (
              <>
                <p className="eq-login-right__eyebrow">Pin reset</p>
                <h2 className="eq-login-right__title">Link broken.</h2>
                <p className="eq-login-right__sub">
                  This page needs a reset token in the URL. Open the link
                  exactly as it was sent, or ask your manager to send a new one.
                </p>
              </>
            ) : (
              <>
                <p className="eq-login-right__eyebrow">PIN reset</p>
                <h2 className="eq-login-right__title">Set a new PIN.</h2>
                <p className="eq-login-right__sub">
                  Pick something you'll remember. 4–12 letters or digits.
                </p>

                <form onSubmit={onSubmit}>
                  <div className="eq-login-field">
                    <label htmlFor="pin" className="eq-login-label">New PIN</label>
                    <input
                      id="pin"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={4}
                      maxLength={12}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      className="eq-login-input"
                      disabled={busy}
                    />
                  </div>

                  <div className="eq-login-field">
                    <label htmlFor="pin-confirm" className="eq-login-label">Confirm PIN</label>
                    <input
                      id="pin-confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={4}
                      maxLength={12}
                      value={pinConfirm}
                      onChange={(e) => setPinConfirm(e.target.value)}
                      className="eq-login-input"
                      disabled={busy}
                    />
                  </div>

                  <button
                    type="submit"
                    className="eq-login-submit"
                    disabled={busy || !pin || !pinConfirm}
                  >
                    {busy ? 'Saving…' : 'Set PIN and sign in →'}
                  </button>

                  {err && (
                    <div className="eq-err" role="alert" style={{ marginTop: 16 }}>
                      {err}
                    </div>
                  )}
                </form>

                <p className="eq-login-foot">
                  Need help?{' '}
                  <a href="mailto:support@eq.solutions">support@eq.solutions</a>
                </p>
              </>
            )}
          </div>
        </div>

        <p className="eq-login-page__copy">
          © EQ Solutions · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
