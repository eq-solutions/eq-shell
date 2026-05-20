import { useEffect, useState } from 'react';
import * as Sentry from '@sentry/react';

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

const FIELD_URL = 'https://eq-solves-field.netlify.app/';

// Field has up to ~10s of cold-start latency in iframe context
// (SW install + tenant config + Supabase round-trip). If no message
// arrives in that window we assume the iframe is dead and show a
// retry prompt. Generous on purpose — false-positive timeouts here
// would be the most annoying possible UX.
const HANDOFF_TIMEOUT_MS = 10_000;

// Message shape contracted with eq-field-app `scripts/auth.js`
// `_postHandoffStatus()` (added in v3.5.12). The shape is versioned;
// bump `version` on both sides when the shape changes.
interface HandoffMessage {
  source: 'eq-field-shell-handoff';
  version: 1;
  kind: 'boot' | 'no-sh-param' | 'accepted' | 'rejected' | 'http-error' | 'network-error';
  hasHash?: boolean;
  status?: number;
  name?: string;
  role?: string;
  detail?: string;
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
  | { phase: 'timeout' };

function isHandoffMessage(data: unknown): data is HandoffMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return m.source === 'eq-field-shell-handoff' && m.version === 1;
}

export default function FieldIframe() {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<HandoffState>({ phase: 'minting' });

  // Mint token + set iframe src.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/mint-iframe-token', {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          if (!cancelled) setState({ phase: 'mint-failed' });
          return;
        }
        const body = (await res.json()) as { token: string };
        if (!cancelled) {
          setSrc(`${FIELD_URL}#sh=${encodeURIComponent(body.token)}`);
          setState({ phase: 'waiting' });
        }
      } catch {
        if (!cancelled) setState({ phase: 'mint-failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      Sentry.captureMessage('EQ Field handoff timeout — no postMessage in 10s', { level: 'error' });
    }, HANDOFF_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  // No iframe yet — show a pre-mount status.
  if (state.phase === 'minting' || state.phase === 'mint-failed') {
    return (
      <div className="eq-field-frame-loading" role={state.phase === 'mint-failed' ? 'alert' : undefined}>
        {state.phase === 'minting'
          ? 'Authorising EQ Field handoff…'
          : 'Could not authorise EQ Field. Sign out and back in, then retry.'}
      </div>
    );
  }

  // Once src is set, the iframe is always in the DOM — overlays
  // sit on top for non-accepted states so we don't unmount Field
  // halfway through its bootstrap.
  return (
    <>
      {src && (
        <iframe
          className="eq-field-frame"
          title="EQ Field"
          src={src}
          // Allow same-origin so Field's existing IndexedDB / cookies
          // continue to work; allow scripts; allow forms (PIN gate
          // submit in the no-shell-token fallback path); allow downloads
          // for CSV exports.
          sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
          // referrerPolicy="no-referrer" — don't leak the parent
          // (<tenant>.eq.solutions) URL via Referer header when Field
          // makes outbound requests. The iframe handoff token in the URL
          // hash already isn't sent as Referer (hashes aren't sent), but
          // this stops any path-based info from leaking.
          referrerPolicy="no-referrer"
          allow=""
        />
      )}
      <HandoffOverlay state={state} />
    </>
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
      <div className="eq-field-frame-overlay" aria-busy="true">
        <div className="eq-field-frame-overlay-card">Loading EQ Field…</div>
      </div>
    );
  }

  const msg = overlayMessage(state);
  return (
    <div className="eq-field-frame-overlay" role="alert">
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
    case 'timeout':
      return "EQ Field didn't respond within 10 seconds. Refresh to retry.";
    default:
      return '';
  }
}
