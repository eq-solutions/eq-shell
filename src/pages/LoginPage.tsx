import React, { useState, useRef, type FormEvent } from 'react';
import './auth.css';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { useSession, type EqRole } from '../session';
import { EqLogo } from '../components/EqLogo';
import { storePendingSelection } from './TenantPicker';

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

  const [mode, setMode] = useState<'link' | 'email' | 'phone'>('link');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Magic link state
  const [linkEmail, setLinkEmail] = useState('');
  const [linkSent, setLinkSent] = useState(false);

  // Email + 4-box PIN
  const [email, setEmail] = useState('');
  const [pinDigits, setPinDigits] = useState(['', '', '', '']);
  const [staySignedIn, setStaySignedIn] = useState(false);
  const [showForgotPin, setShowForgotPin] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotErr, setForgotErr] = useState<string | null>(null);
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

  function switchMode(next: 'link' | 'email' | 'phone') {
    setMode(next);
    setErr(null);
    setLinkSent(false);
  }

  async function onSendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkEmail) return;
    setBusy(true);
    setErr(null);
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await makeAnonClient().auth.signInWithOtp({
      email: linkEmail,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    setBusy(false);
    if (error) {
      // Supabase returns an error for unknown emails only in certain configurations.
      // We show a success state regardless to avoid email enumeration.
      // Genuine misconfig errors (rate limit etc.) are caught here.
      if (error.status === 429) {
        setErr('Too many attempts. Wait a minute and try again.');
        return;
      }
    }
    setLinkSent(true);
  }

  // Password managers autofill the whole PIN into a single field. The visible
  // boxes are maxLength=1, which clips the fill to one digit — so we keep a
  // hidden full-length password input as the autofill target and distribute
  // its value across the four boxes here.
  function setPinFromString(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 4).split('');
    const next = ['', '', '', ''];
    digits.forEach((d, i) => { next[i] = d; });
    setPinDigits(next);
    const target = Math.min(digits.length, 3);
    pinRefs[target].current?.focus();
  }

  function onPinChange(index: number, value: string) {
    const digits = value.replace(/\D/g, '');
    // Autofill / paste dumps multiple chars into one box — distribute from here.
    if (digits.length > 1) {
      const next = [...pinDigits];
      digits.slice(0, 4 - index).split('').forEach((d, i) => { next[index + i] = d; });
      setPinDigits(next);
      const lastFilled = Math.min(index + digits.length - 1, 3);
      pinRefs[lastFilled].current?.focus();
      return;
    }
    const digit = digits;
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

  async function onForgotSubmit(e: FormEvent) {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotBusy(true);
    setForgotErr(null);
    try {
      const res = await fetch('/.netlify/functions/shell-request-pin-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      if (!res.ok) {
        setForgotErr('Something went wrong — please try again.');
      } else {
        setForgotSent(true);
      }
    } catch {
      setForgotErr('Network error — please try again.');
    } finally {
      setForgotBusy(false);
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
        | { valid: true; requires_totp: true; totp_challenge_token: string }
        | { valid: true; requires_tenant_selection: true; user_id: string; selection_token: string; memberships: Array<{ tenant_id: string; role: EqRole; tenant_slug: string; tenant_name: string }>; preferred_tenant_id: string | null }
        | { valid: true; tenant: { slug: string } }
        | { valid: false; error?: string };
      if (!body.valid) {
        const errCode = (body as { error?: string }).error;
        if (errCode === 'no-memberships') {
          setErr("You don't have access to any workspace yet. Ask your administrator.");
        } else {
          setErr('Invalid email or PIN.');
        }
        setBusy(false);
        return;
      }
      if ('requires_totp' in body && body.requires_totp) {
        navigate('/totp-challenge', {
          replace: true,
          state: { totpChallengeToken: body.totp_challenge_token },
        });
        return;
      }
      if ('requires_tenant_selection' in body && body.requires_tenant_selection) {
        storePendingSelection({
          user_id: body.user_id,
          selection_token: body.selection_token,
          memberships: body.memberships,
          preferred_tenant_id: body.preferred_tenant_id,
        });
        navigate('/select-tenant', { replace: true });
        return;
      }
      void refresh();
      navigate(`/${(body as { tenant: { slug: string } }).tenant.slug}`, { replace: true });
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
      void refresh();
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
            <p className="eq-login-left__eyebrow">EQ Solutions</p>
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
                aria-selected={mode === 'link'}
                className={`eq-login-tab${mode === 'link' ? ' eq-login-tab--active' : ''}`}
                onClick={() => switchMode('link')}
              >
                Email link
              </button>
              <button
                role="tab"
                type="button"
                aria-selected={mode === 'email'}
                className={`eq-login-tab${mode === 'email' ? ' eq-login-tab--active' : ''}`}
                onClick={() => switchMode('email')}
              >
                PIN
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

            {mode === 'link' && !linkSent && (
              <form onSubmit={onSendLink}>
                <p className="eq-login-right__sub" style={{ marginBottom: 20 }}>
                  Enter your email and we'll send a sign-in link — no password needed.
                </p>
                <div className="eq-login-field">
                  <label htmlFor="link-email" className="eq-login-label">Email</label>
                  <input
                    id="link-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={linkEmail}
                    onChange={(e) => setLinkEmail(e.target.value)}
                    className="eq-login-input"
                    disabled={busy}
                  />
                </div>
                <button
                  type="submit"
                  className="eq-login-submit"
                  disabled={busy || !linkEmail}
                >
                  {busy ? 'Sending…' : 'Send sign-in link'}
                </button>
              </form>
            )}

            {mode === 'link' && linkSent && (
              <div>
                <p className="eq-login-right__sub" style={{ marginBottom: 12 }}>
                  Check your email — we sent a link to <strong>{linkEmail}</strong>.
                  Click it to sign in.
                </p>
                <p style={{ fontSize: 13, color: 'var(--eq-muted)', marginBottom: 16 }}>
                  No email? Check your spam folder, or{' '}
                  <button
                    type="button"
                    className="eq-login-back-link"
                    onClick={() => { setLinkSent(false); setErr(null); }}
                  >
                    try a different address
                  </button>
                  .
                </p>
              </div>
            )}

            {mode === 'email' && !showForgotPin && (
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

                {/* Hidden autofill target — password managers fill the full PIN
                    here; setPinFromString distributes it into the visible boxes. */}
                <input
                  type="password"
                  name="pin"
                  autoComplete="current-password"
                  inputMode="numeric"
                  tabIndex={-1}
                  aria-hidden="true"
                  value={pin}
                  onChange={(e) => setPinFromString(e.target.value)}
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                />

                <div className="eq-login-field">
                  <div className="eq-login-pin-header">
                    <span className="eq-login-label" style={{ margin: 0 }}>PIN</span>
                    <button
                      type="button"
                      className="eq-login-pin-forgot"
                      onClick={() => { setForgotEmail(email); setForgotSent(false); setForgotErr(null); setShowForgotPin(true); }}
                    >
                      Forgot PIN?
                    </button>
                  </div>
                  <div className="eq-login-pin-row">
                    {pinRefs.map((ref, i) => (
                      <input
                        key={i}
                        ref={ref}
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
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
                  {busy ? 'Signing in…' : 'Sign in →'}
                </button>
              </form>
            )}

            {mode === 'email' && showForgotPin && (
              <form onSubmit={onForgotSubmit}>
                <p className="eq-login-hint" style={{ marginBottom: 16 }}>
                  Enter your email and we'll send a reset link.
                </p>
                <div className="eq-login-field">
                  <label htmlFor="forgot-email" className="eq-login-label">Email</label>
                  <input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="eq-login-input"
                    disabled={forgotBusy || forgotSent}
                  />
                </div>
                {forgotSent ? (
                  <p style={{ fontSize: 13, color: '#3DA8D8', margin: '0 0 16px' }}>
                    Check your email for a reset link.
                  </p>
                ) : (
                  <button
                    type="submit"
                    className="eq-login-submit"
                    disabled={forgotBusy || !forgotEmail}
                  >
                    {forgotBusy ? 'Sending…' : 'Send reset link'}
                  </button>
                )}
                {forgotErr && (
                  <div className="eq-err" role="alert" style={{ marginTop: 12 }}>
                    {forgotErr}
                  </div>
                )}
                <button
                  type="button"
                  className="eq-login-back-link"
                  style={{ display: 'block', marginTop: 12 }}
                  onClick={() => { setShowForgotPin(false); setForgotErr(null); }}
                >
                  ← Back to sign in
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
                  {busy ? 'Signing in…' : 'Sign in →'}
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
