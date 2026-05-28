import { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { useSession } from '../session';
import { HubLayout } from '../components/HubLayout';

// Embeds the existing EQ Field deploy as an iframe.
//
// Two auth modes, selected by VITE_FIELD_URL:
//
// COOKIE MODE (VITE_FIELD_URL=https://field.eq.solutions)
//   eq_shell_session is Domain=.eq.solutions — the browser sends it
//   automatically to field.eq.solutions. Field's verify-pin.js reads
//   it server-side via the 'verify-shell-cookie' action, no token
//   minting needed. Shell embeds Field at:
//     field.eq.solutions/?tenant=<slug>&shell=1
//   Field detects ?shell=1 with no #sh= and tries cookie auth.
//   SKS always uses token mode (sks-nsw-labour.netlify.app ≠ eq.solutions).
//
// TOKEN MODE (fallback, any other VITE_FIELD_URL or SKS tenant)
//   Legacy HMAC handshake: Shell mints a 60s token → embeds Field at
//   /?tenant=<slug>#sh=<token> → Field's verify-pin validates → session.
//
// Activation (cookie mode):
//   1. Add field.eq.solutions as Netlify custom domain on eq-solves-field.
//   2. Set VITE_FIELD_URL=https://field.eq.solutions in eq-shell Netlify env.
//   3. Update eq-solves-field verify-pin.js with verify-shell-cookie action.

const HANDOFF_TIMEOUT_MS = 30_000;

import {
  TENANT_OPTIONS,
  buildFieldSrc,
  buildFieldCookieSrc,
  tenantUsesCookieAuth,
  type TenantOption,
  type TenantSlug,
} from '../lib/fieldTenants';

// Message shape contracted with eq-field-app `scripts/auth.js`
interface HandoffMessage {
  source: 'eq-field-shell-handoff';
  version: 1;
  kind:
    | 'boot'
    | 'no-sh-param'
    | 'accepted'
    | 'rejected'
    | 'http-error'
    | 'network-error'
    | 'tenant-mismatch';
  hasHash?: boolean;
  status?: number;
  name?: string;
  role?: string;
  detail?: string;
  expected?: string;
  got?: string;
}

type HandoffState =
  | { phase: 'minting' }
  | { phase: 'mint-failed' }
  | { phase: 'waiting' }
  | { phase: 'booted'; hasHash: boolean }
  | { phase: 'accepted'; name: string; role: string }
  | { phase: 'rejected' }
  | { phase: 'http-error'; status: number }
  | { phase: 'network-error'; detail: string }
  | { phase: 'no-sh-param' }
  | { phase: 'tenant-mismatch'; expected: string; got: string }
  | { phase: 'timeout' };

function isHandoffMessage(data: unknown): data is HandoffMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return m.source === 'eq-field-shell-handoff' && m.version === 1;
}

export default function FieldIframe() {
  const { session } = useSession();
  const [selectedTenant, setSelectedTenant] = useState<TenantSlug | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<HandoffState>({ phase: 'minting' });
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const visibleOptions = (session?.user.is_platform_admin)
    ? TENANT_OPTIONS
    : TENANT_OPTIONS.filter((t) => t.slug === session?.tenant.slug);

  const autoSlug = visibleOptions.length === 1 ? visibleOptions[0].slug : null;
  useEffect(() => {
    if (autoSlug && !selectedTenant) {
      pickTenant(autoSlug);
    }
  }, [autoSlug]);

  const pickTenant = (slug: TenantSlug) => {
    setSrc(null);
    setState({ phase: 'minting' });
    setSelectedTenant(slug);
  };

  const onSwitch = () => {
    setSrc(null);
    setState({ phase: 'minting' });
    setSelectedTenant(null);
  };

  // Mint token + set iframe src once a tenant is chosen.
  useEffect(() => {
    if (!selectedTenant) return;

    // Cookie auth — no token minting needed. Just set the src directly.
    if (tenantUsesCookieAuth(selectedTenant)) {
      setSrc(buildFieldCookieSrc(selectedTenant));
      setState({ phase: 'waiting' });
      return;
    }

    // Token auth (SKS and fallback).
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/mint-iframe-token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_slug: selectedTenant }),
        });
        if (!res.ok) {
          if (!cancelled) setState({ phase: 'mint-failed' });
          return;
        }
        const body = (await res.json()) as { token: string; tenant_slug: string };
        if (!cancelled) {
          setSrc(buildFieldSrc(body.tenant_slug, body.token));
          setState({ phase: 'waiting' });
        }
      } catch {
        if (!cancelled) setState({ phase: 'mint-failed' });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedTenant]);

  // Listen for handoff status postMessages from Field.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!isHandoffMessage(ev.data)) return;
      const msg = ev.data;
      switch (msg.kind) {
        case 'boot':
          setState({ phase: 'booted', hasHash: !!msg.hasHash });
          break;
        case 'accepted':
          setState({ phase: 'accepted', name: msg.name ?? 'unknown', role: msg.role ?? 'unknown' });
          break;
        case 'rejected':
          setState({ phase: 'rejected' });
          Sentry.captureMessage('EQ Field handoff rejected', { level: 'warning' });
          break;
        case 'http-error':
          setState({ phase: 'http-error', status: msg.status ?? 0 });
          Sentry.captureMessage(`EQ Field handoff HTTP ${msg.status ?? 'unknown'}`, { level: 'error' });
          break;
        case 'network-error':
          setState({ phase: 'network-error', detail: msg.detail ?? '' });
          Sentry.captureMessage(`EQ Field handoff network error: ${msg.detail ?? 'unknown'}`, { level: 'error' });
          break;
        case 'no-sh-param':
          // In cookie mode, no #sh= is expected — Field will try cookie auth instead.
          // Suppress this signal; the accepted/rejected message arrives next.
          if (selectedTenant && tenantUsesCookieAuth(selectedTenant)) break;
          setState({ phase: 'no-sh-param' });
          Sentry.captureMessage('EQ Field handoff: no sh= param in hash', { level: 'warning' });
          break;
        case 'tenant-mismatch':
          setState({
            phase: 'tenant-mismatch',
            expected: msg.expected ?? 'unknown',
            got: msg.got ?? 'unknown',
          });
          Sentry.captureMessage(
            `EQ Field handoff tenant mismatch — Field expected "${msg.expected}", token claims "${msg.got}"`,
            { level: 'error' },
          );
          break;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [selectedTenant]);

  useEffect(() => {
    if (state.phase !== 'waiting') return;
    const timer = setTimeout(() => {
      setState((prev) => (prev.phase === 'waiting' ? { phase: 'timeout' } : prev));
      Sentry.captureMessage('EQ Field handoff timeout — no postMessage in 30s', { level: 'error' });
    }, HANDOFF_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  // TOKEN MODE: token refresh requests from Field.
  useEffect(() => {
    if (selectedTenant && tenantUsesCookieAuth(selectedTenant)) return;
    const expectedOrigin = import.meta.env.VITE_FIELD_URL as string | undefined;
    async function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if ((ev.data as Record<string, unknown>).type !== 'REQUEST_SHELL_TOKEN') return;
      if (expectedOrigin && ev.origin !== expectedOrigin) return;
      const origin = expectedOrigin ?? ev.origin;
      try {
        const res = await fetch('/.netlify/functions/mint-iframe-token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_slug: selectedTenant }),
        });
        if (!res.ok) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'SHELL_TOKEN_RESPONSE', error: 'refresh-failed' },
            origin,
          );
          return;
        }
        const body = (await res.json()) as { token: string };
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'SHELL_TOKEN_RESPONSE', token: body.token },
          origin,
        );
      } catch {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'SHELL_TOKEN_RESPONSE', error: 'refresh-failed' },
          origin,
        );
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [selectedTenant]);

  if (!selectedTenant) {
    if (visibleOptions.length === 1) {
      return (
        <HubLayout iframe>
          <div className="eq-field-frame-loading">Connecting to EQ Field…</div>
        </HubLayout>
      );
    }
    return (
      <HubLayout iframe>
        <TenantPicker options={visibleOptions} onPick={pickTenant} />
      </HubLayout>
    );
  }

  const tenantMeta = TENANT_OPTIONS.find((t) => t.slug === selectedTenant);

  if (state.phase === 'minting' || state.phase === 'mint-failed') {
    return (
      <HubLayout iframe>
        {tenantMeta && <FieldTenantBar tenant={tenantMeta} onSwitch={onSwitch} />}
        <div
          className="eq-field-frame-loading eq-field-frame-loading--with-tenantbar"
          role={state.phase === 'mint-failed' ? 'alert' : undefined}
        >
          {state.phase === 'minting'
            ? 'Authorising EQ Field handoff…'
            : 'Could not authorise EQ Field. Sign out and back in, then retry.'}
        </div>
      </HubLayout>
    );
  }

  const cookieMode = tenantUsesCookieAuth(selectedTenant);

  return (
    <HubLayout iframe>
      {tenantMeta && <FieldTenantBar tenant={tenantMeta} onSwitch={onSwitch} />}
      {src && (
        <iframe
          ref={iframeRef}
          className="eq-field-frame eq-field-frame--with-tenantbar"
          style={{ flex: 1, minHeight: 0 }}
          title="EQ Field"
          src={src}
          sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
          referrerPolicy="no-referrer"
          allow=""
        />
      )}
      <HandoffOverlay state={state} cookieMode={cookieMode} />
    </HubLayout>
  );
}

function TenantPicker({
  options,
  onPick,
}: {
  options: readonly TenantOption[];
  onPick: (slug: TenantSlug) => void;
}) {
  return (
    <div className="eq-field-picker">
      <div className="eq-field-picker__inner">
        <div className="eq-field-picker__eyebrow">EQ Solves · Field</div>
        <h1 className="eq-field-picker__title">Pick a Field workspace</h1>
        <p className="eq-field-picker__lede">
          Select the workspace to open. You'll be signed in automatically — no PIN needed.
        </p>
        <div className="eq-field-picker__grid">
          {options.map((t) => (
            <button
              key={t.slug}
              type="button"
              className={`eq-field-picker__card eq-field-picker__card--${t.slug}`}
              onClick={() => onPick(t.slug)}
            >
              <div className="eq-field-picker__tier">{t.tier}</div>
              <div className="eq-field-picker__name">{t.name}</div>
              <div className="eq-field-picker__tagline">{t.tagline}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FieldTenantBar({ tenant, onSwitch }: { tenant: TenantOption; onSwitch: () => void }) {
  return (
    <div className="eq-field-tenantbar" role="status">
      <div className="eq-field-tenantbar__label">
        <span className="eq-field-tenantbar__tier">{tenant.tier}</span>
        <span className="eq-field-tenantbar__name">{tenant.name}</span>
      </div>
      <button type="button" className="eq-field-tenantbar__switch" onClick={onSwitch}>
        Switch tenant
      </button>
    </div>
  );
}

function HandoffOverlay({ state, cookieMode }: { state: HandoffState; cookieMode: boolean }) {
  if (state.phase === 'accepted') return null;

  // Loading states — keep scrim up while auth is in flight.
  if (
    state.phase === 'waiting' ||
    (state.phase === 'booted' && state.hasHash) ||
    // Cookie mode: booted-without-hash is expected (no #sh= in URL).
    (state.phase === 'booted' && !state.hasHash && cookieMode)
  ) {
    return (
      <div className="eq-field-frame-overlay eq-field-frame-overlay--with-tenantbar" aria-busy="true">
        <div className="eq-field-frame-overlay-card">Loading EQ Field…</div>
      </div>
    );
  }

  const msg = overlayMessage(state, cookieMode);
  if (!msg) return null;
  return (
    <div className="eq-field-frame-overlay eq-field-frame-overlay--with-tenantbar" role="alert">
      <div className="eq-field-frame-overlay-card">{msg}</div>
    </div>
  );
}

function overlayMessage(state: HandoffState, cookieMode: boolean): string {
  switch (state.phase) {
    case 'booted':
      if (!state.hasHash && cookieMode) return '';
      return 'EQ Field loaded without a sign-in token. Refresh to retry.';
    case 'rejected':
      return 'EQ Field rejected the sign-in handoff. Sign out and back in, then retry.';
    case 'http-error':
      return `EQ Field returned HTTP ${state.status} when verifying your session. Try again in a moment.`;
    case 'network-error':
      return 'Network error reaching EQ Field. Check your connection and refresh.';
    case 'no-sh-param':
      return 'EQ Field handoff URL was malformed. Refresh to retry.';
    case 'tenant-mismatch':
      return `EQ Field expected tenant "${state.expected}" but the sign-in token was for "${state.got}". Switch tenant and try again.`;
    case 'timeout':
      return "EQ Field didn't respond within 30 seconds. Refresh to retry.";
    default:
      return '';
  }
}
