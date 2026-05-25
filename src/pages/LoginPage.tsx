// LoginPage — echoes eq.solutions marketing aesthetic.
// Dark navy left, white sign-in card right. Sky used as accent only.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { useSession } from '../session';
import { EqLogo } from '../components/EqLogo';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Stateless anon client for OTP calls — no session, no auto-refresh.
// Created fresh per call so the sign-in page has no persistent Supabase state.
function makeAnonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Normalize an AU mobile to E.164 (+61XXXXXXXXX).
// Accepts: 0412 345 678 · +61 412 345 678 · 412345678
function normalizeAuPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+61') && digits.length === 11) return raw;
  if (digits.startsWith('61') && digits.length === 11) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 10) return '+61' + digits.slice(1);
  if (digits.length === 9 && digits.startsWith('4')) return '+61' + digits;
  return null;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();

  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Email + PIN
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');

  // Phone OTP
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneStep, setPhoneStep] = useState<'number' | 'code'>('number');
  const [phoneNormalized, setPhoneNormalized] = useState('');
  const [otp, setOtp] = useState('');

  function switchMode(next: 'email' | 'phone') {
    setMode(next);
    setErr(null);
  }

  async function onEmailSubmit(e: FormEvent) {
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

  async function onSendCode(e: FormEvent) {
    e.preventDefault();
    const phone = normalizeAuPhone(phoneRaw);
    if (!phone) {
      setErr('Enter a valid Australian mobile number (e.g. 0412 345 678).');
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await makeAnonClient().auth.signInWithOtp({ phone });
    if (error) {
      setErr("Couldn't send the code. Check your number and try again.");
      setBusy(false);
      return;
    }
    setPhoneNormalized(phone);
    setPhoneStep('code');
    setBusy(false);
  }

  async function onVerifyCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const sb = makeAnonClient();
    const { data, error } = await sb.auth.verifyOtp({
      phone: phoneNormalized,
      token: otp,
      type: 'sms',
    });
    if (error || !data.session) {
      setErr("That code didn't match. Check it and try again.");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch('/.netlify/functions/shell-login-phone-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          phone: phoneNormalized,
          access_token: data.session.access_token,
        }),
      });
      const body = (await res.json()) as
        | { valid: true; tenant: { slug: string } }
        | { valid: false };
      if (!body.valid) {
        setErr("No account found for that mobile number. Contact your admin.");
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
        <div className="eq-login-card">
          <div className="eq-login-card__brand">
            <EqLogo size={28} variant="wordmark" />
          </div>

          <h2 className="eq-login-card__title">Sign in</h2>

          <div className="eq-login-tabs" role="tablist">
            <button
              role="tab"
              type="button"
              aria-selected={mode === 'email'}
              className={`eq-login-tab${mode === 'email' ? ' eq-login-tab--active' : ''}`}
              onClick={() => switchMode('email')}
            >
              Email
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={mode === 'phone'}
              className={`eq-login-tab${mode === 'phone' ? ' eq-login-tab--active' : ''}`}
              onClick={() => switchMode('phone')}
            >
              Mobile
            </button>
          </div>

          {mode === 'email' && (
            <form onSubmit={onEmailSubmit}>
              <div className="eq-login-field">
                <label htmlFor="email" className="eq-login-label">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="eq-login-input"
                />
              </div>
              <div className="eq-login-field">
                <label htmlFor="pin" className="eq-login-label">PIN</label>
                <input
                  id="pin"
                  type="password"
                  autoComplete="current-password"
                  inputMode="numeric"
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="eq-login-input"
                />
              </div>
              <button
                type="submit"
                className="eq-login-submit"
                disabled={busy || !email || !pin}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {mode === 'phone' && phoneStep === 'number' && (
            <form onSubmit={onSendCode}>
              <div className="eq-login-field">
                <label htmlFor="mobile" className="eq-login-label">Mobile number</label>
                <input
                  id="mobile"
                  type="tel"
                  autoComplete="tel"
                  placeholder="0412 345 678"
                  required
                  value={phoneRaw}
                  onChange={(e) => setPhoneRaw(e.target.value)}
                  className="eq-login-input"
                />
              </div>
              <button
                type="submit"
                className="eq-login-submit"
                disabled={busy || !phoneRaw.trim()}
              >
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </form>
          )}

          {mode === 'phone' && phoneStep === 'code' && (
            <form onSubmit={onVerifyCode}>
              <p className="eq-login-hint">
                Code sent to {phoneNormalized}.{' '}
                <button
                  type="button"
                  className="eq-login-back-link"
                  onClick={() => { setPhoneStep('number'); setOtp(''); setErr(null); }}
                >
                  Change
                </button>
              </p>
              <div className="eq-login-field">
                <label htmlFor="otp" className="eq-login-label">6-digit code</label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="eq-login-input"
                />
              </div>
              <button
                type="submit"
                className="eq-login-submit"
                disabled={busy || otp.length !== 6}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {err && (
            <div className="eq-err" role="alert" style={{ marginTop: 16 }}>
              {err}
            </div>
          )}

          <p className="eq-login-card__foot">
            No access? Contact your administrator.
          </p>
        </div>

        <p className="eq-login-page__copy">
          © EQ Solutions · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
