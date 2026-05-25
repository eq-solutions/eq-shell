import React, { useState, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { useSession } from '../session';
import { EqLogo } from '../components/EqLogo';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Stateless anon client for OTP calls — no session, no auto-refresh.
function makeAnonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Normalize an AU mobile to E.164 (+61XXXXXXXXX).
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

  // Email + 4-box PIN
  const [email, setEmail] = useState('');
  const [pinDigits, setPinDigits] = useState(['', '', '', '']);
  const [staySignedIn, setStaySignedIn] = useState(false);
  const [showForgotPin, setShowForgotPin] = useState(false);
  const pinRef0 = useRef<HTMLInputElement>(null);
  const pinRef1 = useRef<HTMLInputElement>(null);
  const pinRef2 = useRef<HTMLInputElement>(null);
  const pinRef3 = useRef<HTMLInputElement>(null);
  const pinRefs = [pinRef0, pinRef1, pinRef2, pinRef3];

  // Phone OTP
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneStep, setPhoneStep] = useState<'number' | 'code'>('number');
  const [phoneNormalized, setPhoneNormalized] = useState('');
  const [otp, setOtp] = useState('');

  function switchMode(next: 'email' | 'phone') {
    setMode(next);
    setErr(null);
  }

  function onPinChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...pinDigits];
    next[index] = digit;
    setPinDigits(next);
    if (digit && index < 3) {
      pinRefs[index + 1].current?.focus();
    }
  }

  function onPinKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      pinRefs[index - 1].current?.focus();
    }
  }

  async function onEmailSubmit(e: FormEvent) {
    e.preventDefault();
    const pin = pinDigits.join('');
    if (pin.length < 4) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/.netlify/functions/shell-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, pin, persist: staySignedIn }),
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
        setErr('No account found for that mobile number. Contact your admin.');
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

  const pin = pinDigits.join('');

  return (
    <div className="eq-login-page">
      <div className="eq-login-card-wrap">
        <div className="eq-login-split">

          {/* Dark left panel */}
          <div className="eq-login-left">
            <div className="eq-login-left__brand">
              <EqLogo size={28} variant="wordmark" onDark />
            </div>
            <p className="eq-login-left__eyebrow">EQ Shell</p>
            <h1 className="eq-login-left__heading">
              Your tools.<br /><strong>One sign-in.</strong>
            </h1>
            <ul className="eq-login-left__apps">
              <li>Field</li>
              <li>Service</li>
              <li>Quotes</li>
              <li>Cards</li>
            </ul>
          </div>

          {/* White right panel */}
          <div className="eq-login-right">
            <p className="eq-login-right__eyebrow">Sign in</p>
            <h2 className="eq-login-right__title">Welcome back.</h2>
            <p className="eq-login-right__sub">
              Use the email or mobile linked to your account.
            </p>

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
                  <div className="eq-login-pin-header">
                    <span className="eq-login-label" style={{ margin: 0 }}>PIN</span>
                    <button
                      type="button"
                      className="eq-login-pin-forgot"
                      onClick={() => setShowForgotPin((p) => !p)}
                    >
                      Forgot PIN?
                    </button>
                  </div>
                  {showForgotPin && (
                    <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '0 0 8px' }}>
                      Ask your administrator to send you a reset link.
                    </p>
                  )}
                  <div className="eq-login-pin-row">
                    {pinRefs.map((ref, i) => (
                      <input
                        key={i}
                        ref={ref}
                        type="password"
                        inputMode="numeric"
                        autoComplete={i === 0 ? 'current-password' : 'off'}
                        maxLength={1}
                        value={pinDigits[i]}
                        onChange={(e) => onPinChange(i, e.target.value)}
                        onKeyDown={(e) => onPinKeyDown(i, e)}
                        className="eq-login-pin-box"
                        disabled={busy}
                      />
                    ))}
                  </div>
                </div>

                <label className="eq-login-stay">
                  <input
                    type="checkbox"
                    checked={staySignedIn}
                    onChange={(e) => setStaySignedIn(e.target.checked)}
                    disabled={busy}
                  />
                  Stay signed in on this device
                </label>

                <button
                  type="submit"
                  className="eq-login-submit"
                  disabled={busy || !email || pin.length < 4}
                >
                  {busy ? 'Signing in…' : 'Sign in to the Shell →'}
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
                  {busy ? 'Signing in…' : 'Sign in to the Shell →'}
                </button>
              </form>
            )}

            {err && (
              <div className="eq-err" role="alert" style={{ marginTop: 16 }}>
                {err}
              </div>
            )}

            <p className="eq-login-foot">
              No access yet? Contact your administrator.
            </p>
          </div>
        </div>

        <p className="eq-login-page__copy">
          © EQ Solutions · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
