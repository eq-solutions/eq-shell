/**
 * SPIKE - Passkey enrollment + sign-in demo component.
 *
 * Renders a self-contained demo panel at /auth-spike that steps through:
 *   Step 1 — Email + magic link (baseline credential).
 *   Step 2 — Passkey enrollment (post-login prompt, WebAuthn ceremony).
 *   Step 3 — Passkey sign-in (fingerprint / device PIN).
 *   Step 4 — JWT claims display and @eq-solutions/roles can() permission checks.
 *
 * ISOLATION: This component is ONLY imported by spike/AuthSpikePage.tsx.
 * It is never referenced by the live app tree (App.tsx, session.ts,
 * Netlify functions). The normal login flow is byte-unchanged.
 *
 * EQ brand applied: Plus Jakarta Sans, #3DA8D8 / #2986B4 / #EAF5FB / #1A1A2E.
 * No gradients, no shadows. Linear/Notion aesthetic.
 */

import { useState } from 'react';
import { usePasskeyAuth } from './usePasskeyAuth';
import { isSpikeConfigured } from './supabaseAuthClient';
import { PERMISSIONS } from '@eq-solutions/roles';

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100svh',
    background: '#F8FAFB',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '48px 24px',
    fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
    color: '#1A1A2E',
  },
  card: {
    background: '#fff',
    border: '1px solid #E5E7EB',
    borderRadius: 12,
    padding: '36px 40px',
    width: '100%',
    maxWidth: 520,
    marginBottom: 24,
  },
  badge: {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 99,
    background: '#FEF3C7',
    color: '#92400E',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    marginBottom: 16,
  },
  heading: {
    fontSize: 22,
    fontWeight: 700,
    margin: '0 0 6px',
    color: '#1A1A2E',
  },
  sub: {
    fontSize: 14,
    color: '#6B7280',
    margin: '0 0 28px',
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 6,
    color: '#374151',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #D1D5DB',
    fontSize: 14,
    fontFamily: 'inherit',
    marginBottom: 12,
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  btn: {
    width: '100%',
    padding: '11px 20px',
    borderRadius: 8,
    border: 'none',
    background: '#3DA8D8',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  btnGhost: {
    width: '100%',
    padding: '11px 20px',
    borderRadius: 8,
    border: '1px solid #D1D5DB',
    background: '#fff',
    color: '#374151',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: 8,
  },
  err: {
    padding: '10px 14px',
    borderRadius: 8,
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    color: '#991B1B',
    fontSize: 13,
    marginBottom: 16,
  },
  success: {
    padding: '10px 14px',
    borderRadius: 8,
    background: '#F0FDF4',
    border: '1px solid #BBF7D0',
    color: '#166534',
    fontSize: 13,
    marginBottom: 16,
  },
  info: {
    padding: '10px 14px',
    borderRadius: 8,
    background: '#EAF5FB',
    border: '1px solid #BAE6FD',
    color: '#0C4A6E',
    fontSize: 13,
    marginBottom: 16,
  },
  claimsBox: {
    background: '#F9FAFB',
    border: '1px solid #E5E7EB',
    borderRadius: 8,
    padding: 14,
    fontSize: 12,
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    overflowX: 'auto' as const,
    marginBottom: 20,
    whiteSpace: 'pre' as const,
  },
  permRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 13,
    padding: '5px 0',
    borderBottom: '1px solid #F3F4F6',
  },

  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: '#9CA3AF',
    textTransform: 'uppercase' as const,
    margin: '20px 0 10px',
  },
  notConfigured: {
    padding: '20px 24px',
    borderRadius: 10,
    background: '#FFF7ED',
    border: '1px solid #FED7AA',
    color: '#9A3412',
    fontSize: 13,
    lineHeight: 1.6,
    marginBottom: 24,
  },
};

function dotStyle(granted: boolean): React.CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: granted ? '#22C55E' : '#E5E7EB',
    flexShrink: 0,
  };
}

export default function PasskeySpikeDemo() {
  const auth = usePasskeyAuth();
  const [email, setEmail] = useState('');
  const configured = isSpikeConfigured();

  // Show all permission keys from the @eq-solutions/roles package.
  const allPerms = PERMISSIONS.map((p) => p.key);

  const isAuthed = auth.step === 'authenticated' || auth.step === 'enrolling' || auth.step === 'enrolled';

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 520, marginBottom: 32 }}>
        <span style={S.badge}>SPIKE - Do not merge</span>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 8px', color: '#1A1A2E' }}>
          Auth Re-platform PoC
        </h1>
        <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>
          Supabase Auth + passkeys proof-of-concept. The live login flow is untouched.
          See{' '}
          <code style={{ fontSize: 12, background: '#F3F4F6', padding: '2px 6px', borderRadius: 4 }}>
            AUTH-SPIKE-README.md
          </code>{' '}
          for setup instructions.
        </p>
      </div>

      {/* Configuration warning */}
      {!configured && (
        <div style={{ width: '100%', maxWidth: 520 }}>
          <div style={S.notConfigured}>
            <strong>Spike credentials not configured.</strong>
            <br />
            Add the following to <code>.env.local</code> to connect to a real Supabase
            Auth project:
            <br /><br />
            <code>VITE_SPIKE_SUPABASE_URL=https://&lt;project-ref&gt;.supabase.co</code>
            <br />
            <code>VITE_SPIKE_SUPABASE_ANON_KEY=&lt;anon-key&gt;</code>
            <br /><br />
            The UI below is still rendered so you can inspect the structure and flow.
            Actions will return a "not configured" error.
          </div>
        </div>
      )}

      {/* Device capability */}
      <div style={{ ...S.card, padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <span>
            <strong>Device WebAuthn:</strong>{' '}
            <span style={{ color: auth.webauthnSupported ? '#16A34A' : '#9CA3AF' }}>
              {auth.webauthnSupported ? 'Supported' : 'Not supported / not detected'}
            </span>
          </span>
          <span>
            <strong>Step:</strong> <code style={{ fontSize: 12 }}>{auth.step}</code>
          </span>
        </div>
      </div>

      {/* Error banner */}
      {auth.error && (
        <div style={{ ...S.card, padding: '14px 20px' }}>
          <div style={S.err}>{auth.error}</div>
          <button style={S.btnGhost} onClick={auth.reset}>Dismiss</button>
        </div>
      )}

      {/* Step 1 - Magic link (or passkey sign-in) */}
      {!isAuthed && (
        <div style={S.card}>
          <h2 style={S.heading}>Step 1 - Sign in</h2>
          <p style={S.sub}>
            Enter your email. If you have a passkey enrolled, your browser will offer it
            automatically. Otherwise, a magic link is sent to your inbox.
          </p>

          {auth.step === 'magic_link_sent' && (
            <div style={S.success}>
              Magic link sent. Check your email and click the link to continue.
              When you return, this page will advance automatically.
            </div>
          )}

          {auth.step !== 'magic_link_sent' && (
            <>
              <label style={S.label} htmlFor="spike-email">Email</label>
              {/* autocomplete="webauthn" enables Conditional UI in Chrome/Safari/Firefox */}
              <input
                id="spike-email"
                type="email"
                autoComplete="webauthn"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={S.input}
              />

              <button
                style={S.btn}
                disabled={!email || auth.step === 'signing_in'}
                onClick={() => void auth.signInWithPasskey(email)}
              >
                {auth.step === 'signing_in' ? 'Waiting for fingerprint...' : 'Sign in with fingerprint'}
              </button>

              <button
                style={{ ...S.btnGhost, marginTop: 8 }}
                disabled={!email}
                onClick={() => void auth.sendMagicLink(email)}
              >
                Send magic link instead
              </button>
            </>
          )}
        </div>
      )}

      {/* Step 2 - Passkey enrollment (shown after magic-link sign-in) */}
      {isAuthed && auth.step !== 'enrolled' && (
        <div style={S.card}>
          <h2 style={S.heading}>Step 2 - Set up faster sign-in</h2>
          <p style={S.sub}>
            Use your fingerprint, face, or device PIN to sign in next time.
            Only available on this device.
          </p>

          {auth.step === 'enrolling' && (
            <div style={S.info}>
              Check the browser prompt - your device is asking to confirm your identity.
            </div>
          )}

          {auth.step !== 'enrolling' && (
            <button
              style={S.btn}
              disabled={!auth.webauthnSupported}
              onClick={() => void auth.enrollPasskey()}
            >
              {auth.webauthnSupported
                ? 'Set up sign-in with fingerprint'
                : 'Not available on this device'}
            </button>
          )}

          <button
            style={S.btnGhost}
            onClick={() => void auth.signOut()}
          >
            Sign out instead
          </button>
        </div>
      )}

      {/* Enrollment success */}
      {auth.step === 'enrolled' && (
        <div style={S.card}>
          <div style={S.success}>
            Faster sign-in is set up. Next time, your browser will offer your fingerprint
            or device PIN automatically.
          </div>
          <button style={S.btnGhost} onClick={() => void auth.signOut()}>Sign out</button>
        </div>
      )}

      {/* Step 3 - JWT claims + permission matrix */}
      {isAuthed && auth.claims && (
        <div style={S.card}>
          <h2 style={S.heading}>Step 3 - JWT claims + role check</h2>
          <p style={S.sub}>
            Claims decoded from the Supabase access token app_metadata. These are
            injected by the Custom Access Token Hook. If all values are null, the
            hook is not yet configured (see AUTH-SPIKE-README.md).
          </p>

          <p style={S.sectionTitle}>app_metadata claims</p>
          <pre style={S.claimsBox}>
            {JSON.stringify(auth.claims, null, 2)}
          </pre>

          <p style={S.sectionTitle}>@eq-solutions/roles can() - all permissions</p>
          <div>
            {allPerms.map((perm) => {
              const granted = auth.checkCan(perm);
              return (
                <div key={perm} style={S.permRow}>
                  <span style={dotStyle(granted)} />
                  <code style={{ fontSize: 12, color: '#374151' }}>{perm}</code>
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 11,
                    fontWeight: 600,
                    color: granted ? '#16A34A' : '#9CA3AF',
                  }}>
                    {granted ? 'granted' : 'denied'}
                  </span>
                </div>
              );
            })}
          </div>

          {auth.claims.is_platform_admin && (
            <div style={{ ...S.info, marginTop: 16 }}>
              is_platform_admin = true: all permissions short-circuit to granted
              regardless of eq_role (matching the live useCan() behavior).
            </div>
          )}

          <button style={{ ...S.btnGhost, marginTop: 24 }} onClick={() => void auth.signOut()}>
            Sign out
          </button>
        </div>
      )}

      {/* Footer */}
      <p style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', maxWidth: 520 }}>
        This surface is not deployed. It is behind the /auth-spike route,
        only reachable by navigating directly. No live auth is touched.
      </p>
    </div>
  );
}