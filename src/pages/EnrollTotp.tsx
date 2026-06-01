// /:tenantSlug/settings/2fa — TOTP enrollment (Phase 1.G).
//
// Three-step flow:
//   1. "Start" — calls enroll-totp, receives secret + otpauth URI.
//   2. "Scan" — user scans the QR code or enters the key manually.
//   3. "Confirm" — user enters first 6-digit code, calls confirm-totp.
//      On success, TOTP is live for their account.
//
// Accessible to any logged-in user from the hub.

import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { useParams, Link } from 'react-router-dom';
import { Button } from '@eq-solutions/ui';
import { HubLayout } from '../components/HubLayout';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

type Step = 'idle' | 'scanning' | 'confirming' | 'done' | 'error';

interface EnrollData {
  otpauth_uri: string;
  secret: string;
}

function qrSrc(otpauthUri: string): string {
  // Use a public QR API — the otpauth URI is not sensitive once enrolled;
  // the secret is displayed separately and only to the authenticated user.
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUri)}`;
}

export default function EnrollTotp() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  const [step, setStep] = useState<Step>('idle');
  const [enrollData, setEnrollData] = useState<EnrollData | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startEnrollment() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch('/.netlify/functions/enroll-totp', {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await res.json()) as
        | { ok: true; otpauth_uri: string; secret: string }
        | { ok: false; error?: string };
      if (!body.ok) {
        setErr('Could not start setup — sign out and back in, then try again.');
        setBusy(false);
        return;
      }
      setEnrollData({ otpauth_uri: body.otpauth_uri, secret: body.secret });
      setStep('scanning');
    } catch {
      setErr('Network error — check your connection and try again.');
    }
    setBusy(false);
  }

  async function confirmCode(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setErr('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch('/.netlify/functions/confirm-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) {
        const msgs: Record<string, string> = {
          'bad-code': 'That code is wrong or has expired. Make sure your device clock is correct.',
          'no-pending-secret': 'Setup session expired — start again.',
        };
        setErr(msgs[body.error ?? ''] ?? 'Could not confirm the code. Try again.');
        setBusy(false);
        return;
      }
      setStep('done');
    } catch {
      setErr('Network error — check your connection and try again.');
    }
    setBusy(false);
  }

  return (
    <HubLayout sidebarRecords={SIDEBAR_RECORDS}>
      <div style={{ maxWidth: 540, margin: '0 auto' }}>
        <p style={{ marginBottom: 16 }}>
          <Link to={`/${tenantSlug ?? ''}`} style={{ fontSize: 13 }}>
            ← Back to hub
          </Link>
        </p>

        <div className="eq-page__header">
          <h1 className="eq-page__title">Two-step verification</h1>
          <p className="eq-page__lede">
            Add an authenticator app as a second sign-in step. After setup,
            you'll enter a 6-digit code every time you sign in.
          </p>
        </div>

        {step === 'idle' && (
          <div style={{ marginTop: 24 }}>
            <p style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.6, color: 'var(--eq-grey)' }}>
              You'll need an authenticator app installed on your phone —
              Google Authenticator, Microsoft Authenticator, Authenticator Pro,
              or any TOTP-compatible app.
            </p>
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={startEnrollment}
              style={{ padding: '0 24px' }}
            >
              {busy ? 'Starting…' : 'Set up authenticator →'}
            </Button>
            {err && <div className="eq-err" role="alert" style={{ marginTop: 16 }}>{err}</div>}
          </div>
        )}

        {step === 'scanning' && enrollData && (
          <div style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
              Step 1 — Scan the QR code
            </h2>
            <p style={{ fontSize: 13, color: 'var(--eq-grey)', marginBottom: 16, lineHeight: 1.6 }}>
              Open your authenticator app, tap <strong>+</strong> or{' '}
              <strong>Add account</strong>, then scan this code.
            </p>
            <div style={{ marginBottom: 20 }}>
              <img
                src={qrSrc(enrollData.otpauth_uri)}
                alt="TOTP QR code — scan with your authenticator app"
                width={200}
                height={200}
                style={{ border: '1px solid var(--eq-border)', borderRadius: 8, display: 'block' }}
              />
            </div>
            <details style={{ marginBottom: 20 }}>
              <summary style={{ fontSize: 13, color: 'var(--eq-grey)', cursor: 'pointer' }}>
                Can't scan? Enter the key manually
              </summary>
              <div style={{
                marginTop: 10, padding: '10px 14px',
                background: 'var(--eq-ice)', borderRadius: 6,
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                fontSize: 14, letterSpacing: '0.08em',
                wordBreak: 'break-all',
              }}>
                {enrollData.secret}
              </div>
              <p style={{ fontSize: 12, color: 'var(--eq-grey)', marginTop: 8 }}>
                In your app, choose "Time-based" / "TOTP" and paste this key.
              </p>
            </details>
            <Button
              type="button"
              variant="primary"
              style={{ padding: '0 24px' }}
              onClick={() => setStep('confirming')}
            >
              I've scanned it →
            </Button>
          </div>
        )}

        {step === 'confirming' && (
          <form onSubmit={confirmCode} style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
              Step 2 — Verify your code
            </h2>
            <p style={{ fontSize: 13, color: 'var(--eq-grey)', marginBottom: 16, lineHeight: 1.6 }}>
              Enter the 6-digit code your authenticator app shows for EQ Solutions.
            </p>
            <div style={{ marginBottom: 20 }}>
              <label
                htmlFor="totp-confirm-code"
                style={{
                  display: 'block', fontSize: 11, fontWeight: 600,
                  color: 'var(--eq-grey)', textTransform: 'uppercase',
                  letterSpacing: '0.06em', marginBottom: 8,
                }}
              >
                Authenticator code
              </label>
              <input
                id="totp-confirm-code"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (err) setErr(null);
                }}
                disabled={busy}
                placeholder="000000"
                style={{
                  width: '100%', height: 48, padding: '0 16px',
                  border: '1px solid var(--gray-300)', borderRadius: 6,
                  background: 'var(--eq-bg)', fontSize: 24,
                  textAlign: 'center', letterSpacing: '0.2em',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                style={{ padding: '0 16px' }}
                onClick={() => { setStep('scanning'); setCode(''); setErr(null); }}
              >
                ← Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || code.length !== 6}
                style={{ padding: '0 24px' }}
              >
                {busy ? 'Verifying…' : 'Confirm →'}
              </Button>
            </div>
            {err && <div className="eq-err" role="alert" style={{ marginTop: 16 }}>{err}</div>}
          </form>
        )}

        {step === 'done' && (
          <div style={{ marginTop: 24 }}>
            <div style={{
              padding: '16px 20px',
              background: 'var(--eq-ice)',
              border: '1px solid var(--eq-border)',
              borderRadius: 8,
              marginBottom: 20,
            }}>
              <p style={{ margin: 0, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Check size={16} aria-hidden="true" /> Two-step verification is active
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--eq-grey)' }}>
                From now on, you'll enter a code from your authenticator app each time you sign in.
              </p>
            </div>
            <Link to={`/${tenantSlug ?? ''}`} className="eq-btn-primary" style={{ textDecoration: 'none', display: 'inline-block', padding: '0 24px' }}>
              Back to hub →
            </Link>
          </div>
        )}
      </div>
    </HubLayout>
  );
}
