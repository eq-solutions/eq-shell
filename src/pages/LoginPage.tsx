import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../session';

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/shell-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, pin }),
      });
      const body = (await res.json()) as
        | { valid: true; tenant: { slug: string } }
        | { valid: false };
      if (!body.valid) {
        setErr('Invalid email or PIN.');
        setBusy(false);
        return;
      }
      // Refresh session context, then navigate to the tenant home.
      await refresh();
      navigate(`/${body.tenant.slug}`, { replace: true });
    } catch (e) {
      setErr('Network error — please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="eq-shell">
      <form className="eq-login" onSubmit={onSubmit}>
        <h1>EQ Shell</h1>
        <p className="lede">Sign in with your work email + PIN.</p>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="pin">PIN</label>
        <input
          id="pin"
          type="password"
          autoComplete="current-password"
          inputMode="numeric"
          required
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <button type="submit" disabled={busy || !email || !pin}>
          {busy ? 'Signing in…' : 'Sign in'}
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
