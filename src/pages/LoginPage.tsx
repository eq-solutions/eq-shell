// LoginPage — echoes eq.solutions marketing aesthetic.
// Dark navy left, white sign-in card right. Sky used as accent only.

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
      <aside className="eq-login-hero">
        <header className="eq-login-hero__top">
          <EqLogo size={32} onDark variant="wordmark" />
        </header>
        <div className="eq-login-hero__main">
          <span className="eq-login-hero__eyebrow">
            <span className="eq-login-hero__eyebrow-dot" />
            BUILT IN SYDNEY · FOR AUSTRALIAN BUSINESSES
          </span>
          <h1 className="eq-login-hero__headline">
            The operating system for businesses that <span className="eq-login-hero__accent">actually do the work.</span>
          </h1>
          <p className="eq-login-hero__sub">
            EQ is a modular suite. Start with rostering. Add quoting. Add service. Add assets.
            One login, one set of data, one bill. Pay for what you use — nothing you don't.
          </p>
          <div className="eq-login-hero__trust">
            <span>Pick a module. Trial it free. Keep what works.</span>
            <span className="eq-login-hero__trust-sep">·</span>
            <span>Data stays in Australia</span>
            <span className="eq-login-hero__trust-sep">·</span>
            <span>Built for operators, by operators</span>
          </div>
        </div>
        <footer className="eq-login-hero__foot">
          © EQ Solutions · {new Date().getFullYear()} · core.eq.solutions
        </footer>
      </aside>

      <div className="eq-login-form-wrap">
        <form className="eq-login-form" onSubmit={onSubmit}>
          <h2>Sign in</h2>
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
            {busy ? 'Signing in…' : 'Sign in →'}
          </button>
          {err && (
            <div className="eq-err" role="alert">
              {err}
            </div>
          )}
          <p className="eq-login-form__foot">
            Don't have access? Talk to your EQ admin.
          </p>
        </form>
      </div>
    </div>
  );
}
