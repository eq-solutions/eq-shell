// LoginPage — split-screen brand panel + form. First impression.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { EqLogo } from '../components/EqLogo';

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
      await refresh();
      navigate(`/${body.tenant.slug}`, { replace: true });
    } catch {
      setErr('Network error — please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="eq-login-page">
      <aside className="eq-login-brand">
        <div className="eq-login-brand__mark">
          <EqLogo size={44} className="eq-login-brand__mark-svg" />
          <span className="eq-login-brand__wordmark">EQ Solutions</span>
        </div>
        <div className="eq-login-brand__pitch">
          <h2>The platform behind your work.</h2>
          <p>
            Canonical data, modular surfaces, identity that follows you across every tool. One sign-in.
          </p>
          <div className="eq-login-brand__capabilities">
            <div className="eq-login-brand__capability">
              <span>42 canonical entities, one tenant-scoped data layer</span>
            </div>
            <div className="eq-login-brand__capability">
              <span>Drag-drop CSV intake with AI column mapping</span>
            </div>
            <div className="eq-login-brand__capability">
              <span>5-tier role model with platform-admin oversight</span>
            </div>
            <div className="eq-login-brand__capability">
              <span>Modules: Intake, Cards, Field, Quotes, Service</span>
            </div>
          </div>
        </div>
        <div className="eq-login-brand__foot">© EQ Solutions · {new Date().getFullYear()}</div>
      </aside>
      <div className="eq-login-form-wrap">
        <form className="eq-login-form" onSubmit={onSubmit}>
          <h1>Sign in</h1>
          <p className="lede">Use your work email and PIN.</p>
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
          <button type="submit" className="eq-btn-primary" disabled={busy || !email || !pin}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {err && (
            <div className="eq-err" role="alert">
              {err}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
