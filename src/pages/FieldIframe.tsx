import { useEffect, useState } from 'react';
import * as Sentry from '@sentry/react';
import { useSession } from '../session';
import { HubLayout } from '../components/HubLayout';

// Embeds the existing EQ Field deploy as an iframe. The shell mints
// a 60s HMAC handoff token, passes it via URL hash (NOT query —
// Field clears the hash on consume so the token doesn't end up in
// history/screenshots). See Phase 1.C, PR #106 on eq-field-app/demo
// for the Field-side consumer.
//
// 2026-05-20 — handoff status overlay. Cross-origin sandboxed iframes
// don't expose console output to the parent shell, so when the
// `#sh=` handoff fails inside Field the shell previously just
// rendered a blank iframe with no signal. eq-field v3.5.12 ships a
// postMessage telemetry channel that broadcasts every handoff step;
// we listen here, render a user-facing error on failure, and capture
// the failure mode in Sentry.
//
// 2026-05-21 — wrapped in <Topbar /> so users aren't trapped on the
// iframe surface; matches the audit fix that landed earlier today.
//
// 2026-05-22 — Wave 5: tenant picker on this surface. The shell user
// (always on shell tenant 'core' today) picks which Field organisation
// to load. The mint endpoint accepts the chosen slug in its body and
// stamps it into the signed token; Field's v3.5.17 _consumeShellToken
// cross-checks the slug against the iframe URL's `?tenant=` param and
// rejects mismatches with a 'tenant-mismatch' postMessage. Auto-routing
// from the user's shell tenant_id was tried twice (PR #10, #12) and
// reverted both times — see SHELL-TENANT-PICKER-PROMPT.md §2 for why.
//
// 2026-05-27 — sidebar-alongside layout. Topbar removed; HubLayout
// stays visible alongside the iframe via `iframe` prop on HubLayout.

// Field tenant configuration lives in src/lib/fieldTenants.ts — single
// source of truth for TENANT_OPTIONS, FIELD_TENANT_URLS, and buildFieldSrc.
// When adding a new Field org, update that file AND mint-iframe-token.ts
// ALLOWED_FIELD_TENANT_SLUGS in the same PR.

// Field has cold-start latency in iframe context: SW install, two
// sequential Supabase round-trips inside loadTenantConfig(), then the
// verify-pin call inside _consumeShellToken(). On mobile this chain
// easily hits 15-25s. The 'boot' signal now fires from auth.js before
// those Supabase calls (see _earlyBootSignal), so in practice the
// overlay resolves within a second or two — but we keep a generous
// hard cap here so a genuinely dead iframe is still surfaced.
const HANDOFF_TIMEOUT_MS = 30_000;

import {
  TENANT_OPTIONS,
  buildFieldSrc,
  type TenantOption,
  type TenantSlug,
} from '../lib/fieldTenants';

// Message shape contracted with eq-field-app `scripts/auth.js`
// `_postHandoffStatus()` (added in v3.5.12, extended in v3.5.17 with
// 'tenant-mismatch'). The shape is versioned; bump `version` on both
// sides when the shape changes.
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
  | { phase: 'waiting' } // iframe src set, waiting for first postMessage
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
  // null = picker shown; once set, mint+embed runs.
  const [selectedTenant, setSelectedTenant] = useState<TenantSlug | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<HandoffState>({ phase: 'minting' });

  // Platform admins see every tenant in the picker; everyone else sees
  // only the tenant that matches their shell session. SKS staff should
  // never see EQ Demo / Demo Trades / Melbourne.
  const visibleOptions = (session?.user.is_platform_admin)
    ? TENANT_OPTIONS
    : TENANT_OPTIONS.filter((t) => t.slug === session?.tenant.slug);

  // Auto-select the sole option for non-admin users. useEffect defers
  // the state update out of render, replacing the prior setTimeout(0).
  const autoSlug = visibleOptions.length === 1 ? visibleOptions[0].slug : null;
  useEffect(() => {
    if (autoSlug && !selectedTenant) {
      pickTenant(autoSlug);
    }
  }, [autoSlug]); // autoSlug is stable after session loads; selectedTenant check guards re-fire

  // Resetting src + state happens in the pick/switch event handlers
  // below (not in the mint effect) — keeps the effect a pure
  // "synchronise external system" call, no cascading renders.
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

  // Mint token + set iframe src once a tenant is chosen. Re-runs if
  // the user hits "Switch tenant" — selectedTenant returns to null,
  // then they pick again and this fires fresh.
  useEffect(() => {
    if (!selectedTenant) return;
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
          // ?tenant=<slug> sets Field's TENANT.ORG_SLUG before the
          // token is verified; the token's tenant_slug claim is then
          // cross-checked against it. Both must agree or Field
          // rejects with 'tenant-mismatch'. We use body.tenant_slug
          // (what the server actually signed) rather than the local
          // selectedTenant so the URL never disagrees with the token.
          setSrc(buildFieldSrc(body.tenant_slug, body.token));
          setState({ phase: 'waiting' });
        }
      } catch {
        if (!cancelled) setState({ phase: 'mint-failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTenant]);

  // Listen for handoff status from the iframe. We deliberately don't
  // pin the event.source to a specific window: capturing the iframe
  // ref to assert against is awkward, the payload contains no
  // actions, and the worst a spoofed message could do is render a
  // misleading overlay (the iframe is still the real one).
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
          setState({ phase: 'no-sh-param' });
          Sentry.captureMessage('EQ Field handoff: no sh= param in hash', { level: 'warning' });
          break;
        case 'tenant-mismatch':
          // Field booted under a tenant slug that doesn't match the
          // one stamped on the token. With Wave 5 the URL is derived
          // from the same server response that signed the token, so
          // this should be near-impossible — if it fires, suspect a
          // stale Field SW cache or a URL the user edited by hand.
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
  }, []);

  // Timeout — if no boot message arrives within HANDOFF_TIMEOUT_MS
  // of the iframe being mounted, assume the iframe is wedged.
  useEffect(() => {
    if (state.phase !== 'waiting') return;
    const timer = setTimeout(() => {
      setState((prev) => (prev.phase === 'waiting' ? { phase: 'timeout' } : prev));
      Sentry.captureMessage('EQ Field handoff timeout — no postMessage in 30s', { level: 'error' });
    }, HANDOFF_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  // Picker — no tenant chosen yet. Auto-select fires via useEffect above
  // for single-option users; show loading state while that fires.
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

  // No iframe yet — show a pre-mount status (still under the sidebar
  // + tenant bar so the user can bail out to the picker).
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

  // Once src is set, the iframe is always in the DOM — overlays
  // sit on top for non-accepted states so we don't unmount Field
  // halfway through its bootstrap.
  return (
    <HubLayout iframe>
      {tenantMeta && <FieldTenantBar tenant={tenantMeta} onSwitch={onSwitch} />}
      {src && (
        <iframe
          className="eq-field-frame eq-field-frame--with-tenantbar"
          style={{ flex: 1, minHeight: 0 }}
          title="EQ Field"
          src={src}
          // Allow same-origin so Field's existing IndexedDB / cookies
          // continue to work; allow scripts; allow forms (PIN gate
          // submit in the no-shell-token fallback path); allow downloads
          // for CSV exports.
          sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
          // Don't leak the parent (<tenant>.eq.solutions) URL via
          // Referer header when Field makes outbound requests. The
          // hash-based handoff token already isn't sent as Referer
          // (hashes aren't sent), but this stops any path-based info
          // from leaking.
          referrerPolicy="no-referrer"
          allow=""
        />
      )}
      <HandoffOverlay state={state} />
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

function HandoffOverlay({ state }: { state: HandoffState }) {
  // Accepted is the happy path — no overlay.
  if (state.phase === 'accepted') return null;

  // Booted-with-hash means Field's scripts loaded and the handoff is
  // mid-flight. Keep showing the loading scrim — accepted/rejected
  // will land next. (Booted-without-hash means we passed no token,
  // which shouldn't happen on this route; surface it as a warning.)
  if (state.phase === 'waiting' || (state.phase === 'booted' && state.hasHash)) {
    return (
      <div className="eq-field-frame-overlay eq-field-frame-overlay--with-tenantbar" aria-busy="true">
        <div className="eq-field-frame-overlay-card">Loading EQ Field…</div>
      </div>
    );
  }

  const msg = overlayMessage(state);
  return (
    <div className="eq-field-frame-overlay eq-field-frame-overlay--with-tenantbar" role="alert">
      <div className="eq-field-frame-overlay-card">{msg}</div>
    </div>
  );
}

function overlayMessage(state: HandoffState): string {
  switch (state.phase) {
    case 'booted':
      // hasHash false — the URL passed to the iframe had no #sh= for some reason.
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
