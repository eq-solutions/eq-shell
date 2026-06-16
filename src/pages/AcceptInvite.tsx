// Public landing page for the invite-accept flow (Phase 1.F).
//
// Reads `?token=<raw>` from the URL, asks the user for a PIN, posts
// /.netlify/functions/accept-invite. On success: the function sets
// the session cookie + returns the hydrated user/tenant/entitlements;
// we refresh SessionContext and route to `/<tenant>/`.
//
// No login required to reach this page — the invite token IS the
// authentication. Linked to from the invite email.
//
// 2026-05-21 — rewrote on the canonical LoginPage aesthetic so the
// new user's first impression matches the marketing site.

import { useState, type FormEvent } from 'react';
import './auth.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { useSession } from '../session';
import { EqLogo } from '../components/EqLogo';

export default function AcceptInvite() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);

  if (!token) {
    return (
      <AcceptInviteShell>
        <h2>Invite link broken</h2>
        <p className="lede">
          This page needs an invite token in the URL. Open the link from
          your invite email exactly as it appeared.
        </p>
      </AcceptInviteShell>
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
      const res = await fetch('/.netlify/functions/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invite_token: token, pin }),
      });
      const body = (await res.json()) as
        | { valid: true; tenant: { slug: string } }
        | { valid: false; error?: string };
      if (!body.valid) {
        if (body.error === 'user-already-exists') {
          setErr('An account with this email already exists.');
          setShowSignIn(true);
          setBusy(false);
          return;
        }
        const map: Record<string, string> = {
          'invite-not-found-or-expired':
            'This link has already been used or has expired. Ask your admin to send a new invite.',
          'bad-pin': 'PIN must be 4–12 letters or digits, no spaces.',
          'bad-request': 'Something went wrong with the request — try again.',
          'phone-already-linked':
            'The mobile number on your invite is already linked to another account. Contact your admin to update it and resend the invite.',
        };
        setErr(map[body.error ?? ''] ?? 'Could not accept the invite. Try again or ask your admin.');
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
    <AcceptInviteShell>
      <form className="eq-login-form" onSubmit={onSubmit}>
        <h2>Welcome aboard</h2>
        <p className="lede">
          Pick a PIN you'll use to sign in. 4–12 letters or digits. Don't share
          it.
        </p>
        <label htmlFor="pin">PIN</label>
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
          {busy ? 'Setting up…' : 'Set PIN and continue →'}
        </Button>
        {err && (
          <div className="eq-err" role="alert">
            {err}
            {showSignIn && (
              <>
                {' '}
                <a href="/" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
                  Sign in instead →
                </a>
              </>
            )}
          </div>
        )}
        <p className="eq-login-form__foot">
          Got the wrong link?{' '}
          <a href="mailto:support@eq.solutions">support@eq.solutions</a>
        </p>
      </form>
    </AcceptInviteShell>
  );
}

function AcceptInviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="eq-login-page">
      <aside className="eq-login-hero">
        <header className="eq-login-hero__top">
          <EqLogo size={32} onDark variant="wordmark" />
        </header>
        <div className="eq-login-hero__main">
          <span className="eq-login-hero__eyebrow">
            <span className="eq-login-hero__eyebrow-dot" />
            WELCOME · YOU'VE BEEN INVITED TO EQ
          </span>
          <h1 className="eq-login-hero__headline">
            One PIN, every <span className="eq-login-hero__accent">EQ tool</span>.
          </h1>
          <p className="eq-login-hero__sub">
            Set your PIN once. Use it to sign in across Field, Cards, Intake,
            and everything else your team has access to. Your manager picks the
            apps; you just bring your trade and your tickets.
          </p>
          <div className="eq-login-hero__trust">
            <span>One sign-in, every app</span>
            <span className="eq-login-hero__trust-sep">·</span>
            <span>Data stays in Australia</span>
            <span className="eq-login-hero__trust-sep">·</span>
            <span>Built for operators, by operators</span>
          </div>
        </div>
        <footer className="eq-login-hero__foot">
          © EQ Solutions · {new Date().getFullYear()}
        </footer>
      </aside>

      <div className="eq-login-form-wrap">{children}</div>
    </div>
  );
}
