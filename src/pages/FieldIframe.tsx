import { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { useSession } from '../session';
import { HubLayout } from '../components/HubLayout';
import { EqError } from '../components/EqError';

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
  FIELD_TENANT_URLS,
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

// Assert at module load time that VITE_FIELD_URL is configured.
// Without it the iframe bridge has no trusted origin to validate against
// and token refresh postMessages would be accepted from any origin.
const _FIELD_URL = import.meta.env.VITE_FIELD_URL as string | undefined;
if (!_FIELD_URL || _FIELD_URL.trim() === '') {
  throw new Error('VITE_FIELD_URL is not configured — iframe bridge will not work');
}
// Validate VITE_FIELD_URL is a parseable URL — throws at module load if not.
new URL(_FIELD_URL);

export default function FieldIframe({ active = true }: { active?: boolean }) {
  const { session, loading } = useSession();
  const [selectedTenant, setSelectedTenant] = useState<TenantSlug | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<HandoffState>({ phase: 'minting' });
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // For non-admins: resolve their Field workspace from field_tenant_slug
  // (set in Admin → Settings), falling back to matching by shell tenant slug.
  // Platform admins always see the full picker so they can switch between orgs.
  const nonAdminSlug: TenantSlug | null = (() => {
    if (session?.user.is_platform_admin) return null;
    const configured = session?.tenant.field_tenant_slug;
    if (configured && TENANT_OPTIONS.some((t) => t.slug === configured)) return configured as TenantSlug;
    const matched = TENANT_OPTIONS.find((t) => t.slug === session?.tenant.slug);
    return matched?.slug ?? null;
  })();

  const visibleOptions = session?.user.is_platform_admin
    ? TENANT_OPTIONS
    : nonAdminSlug
      ? TENANT_OPTIONS.filter((t) => t.slug === nonAdminSlug)
      : [];

  // Platform admins auto-route into a workspace instead of stopping at the
  // "Pick a Field workspace" picker on entry (Royce 2026-06-06): last-picked →
  // configured field_tenant_slug → their own shell tenant (if it maps to a
  // Field org) → first option. Non-admins already auto-route to their single
  // workspace. The picker is now effectively bypassed for everyone; it remains
  // only as a fallback if no default can be resolved.
  const adminDefaultSlug: TenantSlug | null = (() => {
    if (!session?.user.is_platform_admin) return null;
    // Honor the tenant the admin is currently in FIRST. The /:tenantSlug/ shell
    // context is forced to equal session.tenant.slug by RequireSession, so an
    // admin who has switched into (e.g.) SKS and opens /sks/field must land on
    // SKS Field — not whatever workspace they last picked. Without this, a sticky
    // localStorage default (e.g. 'eq') overrode the explicit /sks/ context and
    // loaded the wrong (empty) tenant. Last-pick now applies only as a fallback
    // when the active tenant has no Field org.
    const ownMatch = TENANT_OPTIONS.find((t) => t.slug === session?.tenant.slug);
    if (ownMatch) return ownMatch.slug;
    const stored = localStorage.getItem('eq-field-default-tenant');
    if (stored && TENANT_OPTIONS.some((t) => t.slug === stored)) return stored as TenantSlug;
    const configured = session?.tenant.field_tenant_slug;
    if (configured && TENANT_OPTIONS.some((t) => t.slug === configured)) return configured as TenantSlug;
    return TENANT_OPTIONS[0]?.slug ?? null;
  })();

  const autoSlug: TenantSlug | null =
    visibleOptions.length === 1 ? visibleOptions[0].slug : adminDefaultSlug;

  useEffect(() => {
    if (autoSlug && !selectedTenant) {
      pickTenant(autoSlug);
    }
  }, [autoSlug]);

  const pickTenant = (slug: TenantSlug) => {
    if (session?.user.is_platform_admin) {
      localStorage.setItem('eq-field-default-tenant', slug);
    }
    setSrc(null);
    setState({ phase: 'minting' });
    setSelectedTenant(slug);
  };

  // Mint token + set iframe src once a tenant is chosen.
  useEffect(() => {
    if (!selectedTenant) return;

    // One correlation id per Field-iframe load. It rides ALONGSIDE the signed
    // #sh= handoff (a query param in cookie mode) so a single sign-in is
    // traceable core→Field: Field reads `cid` at boot and tags its own Sentry
    // events with it. Tagging Shell's scope here means the handoff captureMessage
    // calls below carry the same id.
    const cid = crypto.randomUUID();
    Sentry.getCurrentScope().setTag('cid', cid);

    // Cookie auth — no token minting needed. Just set the src directly.
    if (tenantUsesCookieAuth(selectedTenant)) {
      setSrc(buildFieldCookieSrc(selectedTenant, cid));
      setState({ phase: 'waiting' });
      return;
    }

    // Token auth (SKS and fallback).
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/token-exchange', {
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
          setSrc(buildFieldSrc(body.tenant_slug, body.token, cid));
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
    // Build the set of origins from which Field postMessages are accepted.
    // Derived from FIELD_TENANT_URLS so it stays in sync automatically.
    const allowedOrigins = new Set(
      Object.values(FIELD_TENANT_URLS).map((u) => new URL(u).origin),
    );
    function onMessage(ev: MessageEvent) {
      if (!allowedOrigins.has(ev.origin)) return;
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
    // Only start the timeout when the iframe is the active/visible frame.
    // When pre-warming in the background (active=false), Field may not send
    // a postMessage within 30s — that's expected, not an error.
    if (!active) return;
    const timer = setTimeout(() => {
      setState((prev) => (prev.phase === 'waiting' ? { phase: 'timeout' } : prev));
      Sentry.captureMessage('EQ Field handoff timeout — no postMessage in 30s', { level: 'error' });
    }, HANDOFF_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.phase, active]);

  // TOKEN MODE: token refresh requests from Field.
  useEffect(() => {
    if (selectedTenant && tenantUsesCookieAuth(selectedTenant)) return;
    // Derive the trusted origin from the CURRENT tenant's Field URL, not from
    // VITE_FIELD_URL. SKS maps to eq-field.netlify.app while VITE_FIELD_URL
    // points to field.eq.solutions — using a single module-level constant
    // silently dropped every SKS refresh request.
    const tenantFieldUrl =
      (selectedTenant && FIELD_TENANT_URLS[selectedTenant]) || _FIELD_URL || 'https://eq-field.netlify.app/';
    const expectedOrigin = new URL(tenantFieldUrl).origin;
    async function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if ((ev.data as Record<string, unknown>).type !== 'REQUEST_SHELL_TOKEN') return;
      if (ev.origin !== expectedOrigin) return;
      try {
        const res = await fetch('/.netlify/functions/token-exchange', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_slug: selectedTenant }),
        });
        if (!res.ok) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'SHELL_TOKEN_RESPONSE', error: 'refresh-failed' },
            expectedOrigin,
          );
          return;
        }
        const body = (await res.json()) as { token: string };
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'SHELL_TOKEN_RESPONSE', token: body.token },
          expectedOrigin,
        );
      } catch {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'SHELL_TOKEN_RESPONSE', error: 'refresh-failed' },
          expectedOrigin,
        );
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [selectedTenant]);

  // Picker — no tenant chosen yet.
  if (!selectedTenant) {
    // No Field workspace configured for this account.
    // Guard: if session is still being verified (stale sessionStorage in-flight),
    // show "Connecting…" rather than flashing the error — verify-shell-session
    // will refresh the session with the correct is_platform_admin / tenant.slug.
    if (visibleOptions.length === 0) {
      if (loading) {
        return (
          <HubLayout iframe hideMainSidebar>
            <div className="eq-field-frame-loading">Connecting to EQ Field…</div>
          </HubLayout>
        );
      }
      return (
        <HubLayout iframe hideMainSidebar>
          <div className="eq-field-frame-loading">
            EQ Field isn't linked to this account yet. Contact your manager.
          </div>
        </HubLayout>
      );
    }
    // A default resolved (single option, or an admin's resolved default) —
    // auto-select fires via the pickTenant effect; show loading until it does,
    // so the picker never flashes on entry.
    if (autoSlug) {
      return (
        <HubLayout iframe hideMainSidebar>
          <div className="eq-field-frame-loading">Connecting to EQ Field…</div>
        </HubLayout>
      );
    }
    // No default could be resolved — fall back to the full picker.
    return (
      <HubLayout iframe>
        <TenantPicker options={visibleOptions} onPick={pickTenant} />
      </HubLayout>
    );
  }

  if (state.phase === 'minting' || state.phase === 'mint-failed') {
    return (
      <HubLayout iframe>
        {state.phase === 'minting' ? (
          <div className="eq-field-frame-loading">
            Connecting to EQ Field…
          </div>
        ) : (
          <div className="eq-iframe-error-wrap">
            <EqError
              title="EQ Field didn't connect"
              message="We couldn't sign you in to EQ Field. Sign out and back in, then try again."
              retryLabel="Refresh page"
              onRetry={() => window.location.reload()}
            />
          </div>
        )}
      </HubLayout>
    );
  }

  const cookieMode = tenantUsesCookieAuth(selectedTenant);

  return (
    <HubLayout iframe>
      {src && (
        <iframe
          ref={iframeRef}
          className="eq-field-frame"
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
      <div className="eq-field-frame-overlay" aria-busy="true">
        <div className="eq-field-frame-overlay-card">Loading EQ Field…</div>
      </div>
    );
  }

  const msg = overlayMessage(state, cookieMode);
  if (!msg) return null;
  return (
    <div className="eq-field-frame-overlay">
      <div className="eq-field-frame-overlay-card eq-field-frame-overlay-card--error">
        <EqError
          title="EQ Field didn't load"
          message={msg}
          retryLabel="Refresh page"
          onRetry={() => window.location.reload()}
        />
      </div>
    </div>
  );
}

function overlayMessage(state: HandoffState, cookieMode: boolean): string {
  switch (state.phase) {
    case 'booted':
      if (!state.hasHash && cookieMode) return '';
      return 'EQ Field opened without a sign-in token.';
    case 'rejected':
      return "EQ Field couldn't sign you in. Sign out and back in, then try again.";
    case 'http-error':
      return `EQ Field hit an error (HTTP ${state.status}) while checking your sign-in. Try again in a moment.`;
    case 'network-error':
      return "We couldn't reach EQ Field. Check your connection.";
    case 'no-sh-param':
      return "EQ Field's sign-in link was incomplete.";
    case 'tenant-mismatch':
      return `EQ Field opened the wrong workspace ("${state.got}" instead of "${state.expected}"). Switch workspace and try again.`;
    case 'timeout':
      return "EQ Field didn't respond within 30 seconds.";
    default:
      return '';
  }
}
