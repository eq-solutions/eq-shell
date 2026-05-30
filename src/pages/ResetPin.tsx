// Public landing page for PIN reset.
// Reads ?token= from URL, asks for new PIN, POSTs to accept-pin-reset.
// No session required — the token is the authentication.

import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
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

  if (!token) {
    return (
      <Shell>
        <h2>Link broken</h2>
        <p className="lede">
          This page needs a reset token in the URL. Open the link you were sent
          exactly as it appeared, or ask your manager to send a new one.
        </p>
      </Shell>
    );
  }

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
          'token-not-found-or-expired': 'This reset link has expired or already been used. Ask your manager for a new one.',
          'bad-pin': 'PIN must be 4–12 letters or digits.',
          'bad-request': 'Something went wrong — try again.',
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
    <Shell>
      <form className="eq-login-form" onSubmit={onSubmit}>
        <h2>Set a new PIN</h2>
        <p className="lede">
          Pick a PIN you'll use to sign in. 4–12 letters or digits.
        </p>
        <label htmlFor="pin">New PIN</label>
        <input
          id="pin"
          type="password"
          autoComplete="new-password"
          inputMode="text"
          required
          minLength={4}
          maxLength={12}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <label htmlFor="pin-confirm">Confirm PIN</label>
        <input
          id="pin-confirm"
          type="password"
          autoComplete="new-password"
          inputMode="text"
          required
          minLength={4}
          maxLength={12}
          value={pinConfirm}
          onChange={(e) => setPinConfirm(e.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !pin || !pinConfirm}
          style={{ width: '100%' }}
        >
          {busy ? 'Saving…' : 'Set PIN and sign in →'}
        </Button>
        {err && (
          <div className="eq-err" role="alert">
            {err}
          </div>
        )}
        <p className="eq-login-form__foot">
          Need help?{' '}
          <a href="mailto:support@eq.solutions">support@eq.solutions</a>
        </p>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="eq-login-page">
      <aside className="eq-login-hero">
        <header className="eq-login-hero__top">
          <EqLogo size={32} onDark variant="wordmark" />
        </header>
        <div className="eq-login-hero__main">
          <span className="eq-login-hero__eyebrow">
            <span className="eq-login-hero__eyebrow-dot" />
            PIN RESET · EQ SOLUTIONS
          </span>
          <h1 className="eq-login-hero__headline">
            Set a new <span className="eq-login-hero__accent">PIN</span>.
          </h1>
          <p className="eq-login-hero__sub">
            One PIN, every EQ tool. Your manager sent you this link because
            your PIN needed a reset — set a new one and you're straight back in.
          </p>
        </div>
        <footer className="eq-login-hero__foot">
          © EQ Solutions · {new Date().getFullYear()} · reset-pin
        </footer>
      </aside>
      <div className="eq-login-form-wrap">{children}</div>
    </div>
  );
}
