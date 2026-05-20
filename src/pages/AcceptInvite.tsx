// Public landing page for the invite-accept flow (Phase 1.F).
//
// Reads `?token=<raw>` from the URL, asks the user for a PIN, posts
// /.netlify/functions/accept-invite. On success: the function sets
// the session cookie + returns the hydrated user/tenant/entitlements;
// we refresh SessionContext and route to `/<tenant>/`.
//
// No login required to reach this page — the invite token IS the
// authentication. Linked to from the invite email.

import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../session';

export default function AcceptInvite() {
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
      <div className="eq-shell">
        <div className="eq-login">
          <h1>Invite link broken</h1>
          <p className="lede">
            This page needs an invite token in the URL. Open the link from
            your invite email exactly as it appeared.
          </p>
        </div>
      </div>
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
        const map: Record<string, string> = {
          'invite-not-found-or-expired':
            'This invite is no longer valid. Ask your admin for a new one.',
          'user-already-exists':
            'An account with this email already exists. Try signing in instead.',
          'bad-pin': 'PIN must be 4–12 letters or digits.',
          'bad-request': 'Something went wrong with the request — try again.',
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
    <div className="eq-shell">
      <form className="eq-login" onSubmit={onSubmit}>
        <h1>Set your PIN</h1>
        <p className="lede">
          Pick a PIN you'll use to sign in. 4–12 letters or digits. Don't
          share it.
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
        <button type="submit" disabled={busy || !pin || !pinConfirm}>
          {busy ? 'Setting up…' : 'Set PIN and continue'}
        </button>
        {err && (
          <div className="err" role="alert">
            {err}
          </div>
        )}
      </form>
    </div>
  );
}
