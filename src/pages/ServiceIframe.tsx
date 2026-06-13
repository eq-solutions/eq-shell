import { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { HubLayout } from '../components/HubLayout';
import { EqError } from '../components/EqError';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// Embeds EQ Service (Next.js) as a Shell iframe.
//
// Auth mode: TOKEN MODE (Supabase JWT handshake).
//
// Shell mints a 60s Supabase JWT via /.netlify/functions/token-exchange?aud=service,
// then embeds Service at /shell#sh=<token>. Service's /shell page POSTs to
// /api/shell-auth, validates the JWT, sets the eq_shell_bridge cookie, and
// redirects to /. Service's (app)/layout.tsx then fires ShellReadySignal which
// postMessages EQ_SERVICE_READY back to Shell — Shell reveals the iframe.
//
// COOKIE MODE was an optimisation for same-site (eq.solutions) deploys that
// relied on eq_shell_session being auto-sent in the iframe. It was disabled
// after investigation showed the cookie was not reliably present at iframe-load
// time (Shell restores from Supabase cookies on refresh without re-minting the
// shell session cookie). TOKEN MODE works on all domains including deploy previews.

const SERVICE_URL = (import.meta.env.VITE_SERVICE_URL as string | undefined)
  ?? 'https://service.eq.solutions';

// TOKEN MODE is always used. COOKIE_AUTH kept as a constant for the conditional
// blocks below (all branches evaluate to the TOKEN path at compile time).
const COOKIE_AUTH = false;

const SERVICE_TIMEOUT_MS = COOKIE_AUTH ? 20_000 : 45_000;

type FrameState =
  | { phase: 'minting' }
  | { phase: 'loading'; src: string }
  | { phase: 'ready'; src: string }
  | { phase: 'error'; msg: string };

export default function ServiceIframe() {
  const [state, setState] = useState<FrameState>(
    COOKIE_AUTH
      ? { phase: 'loading', src: SERVICE_URL }
      : { phase: 'minting' },
  );
  const loadCount = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // TOKEN MODE: mint the HMAC handoff token before setting the iframe src.
  useEffect(() => {
    if (COOKIE_AUTH) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/token-exchange', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aud: 'service' }),
        });
        if (!res.ok) {
          if (!cancelled) setState({ phase: 'error', msg: 'Could not authorise EQ Service. Sign out and back in.' });
          return;
        }
        const { token } = (await res.json()) as { token: string };
        if (!cancelled) {
          setState({
            phase: 'loading',
            src: `${SERVICE_URL}/shell#sh=${token}`,
          });
        }
      } catch {
        if (!cancelled) setState({ phase: 'error', msg: 'Network error reaching EQ Service. Check your connection.' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Timeout — fires if iframe never becomes ready.
  useEffect(() => {
    if (state.phase !== 'loading') return;
    const timer = setTimeout(() => {
      Sentry.captureMessage('EQ Service iframe did not load within timeout', { level: 'error' });
      setState((prev) =>
        prev.phase === 'loading'
          ? { phase: 'error', msg: 'EQ Service took too long to respond. Try refreshing.' }
          : prev,
      );
    }, SERVICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  // Prefer postMessage readiness signal from Service.
  useEffect(() => {
    if (state.phase !== 'loading') return;
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== SERVICE_URL) return;
      if (!ev.data || typeof ev.data !== 'object') return;
      if (ev.data.type === 'EQ_SERVICE_READY') {
        Sentry.addBreadcrumb({ category: 'service-iframe', message: 'EQ_SERVICE_READY received', level: 'info' });
        setState((prev) => (prev.phase === 'loading' ? { ...prev, phase: 'ready' } : prev));
      } else if (ev.data.type === 'EQ_SERVICE_ERROR') {
        const code = (ev.data as Record<string, unknown>).code;
        const msg =
          code === 'service-account-not-found'
            ? "Your account isn't set up in EQ Service yet. Contact your administrator."
            : code === 'invalid-token'
              ? 'The sign-in link expired. Refresh the page to try again.'
              : 'EQ Service could not sign you in. Refresh the page to try again.';
        setState({ phase: 'error', msg });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [state.phase]);

  // TOKEN MODE: token refresh requests from Service.
  useEffect(() => {
    if (COOKIE_AUTH) return;
    // Fail closed: SERVICE_URL is always set (has a hardcoded fallback),
    // so this check never accidentally accepts messages from arbitrary origins.
    const expectedOrigin = new URL(SERVICE_URL).origin;
    async function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if ((ev.data as Record<string, unknown>).type !== 'REQUEST_SHELL_TOKEN') return;
      if (ev.origin !== expectedOrigin) return;
      const origin = expectedOrigin;
      try {
        const res = await fetch('/.netlify/functions/token-exchange', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aud: 'service' }),
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
  }, []);

  function onIframeLoad() {
    loadCount.current += 1;
    if (COOKIE_AUTH) {
      // Cookie mode: first onLoad = Service rendered with auth established.
      // EQ_SERVICE_READY postMessage is still the primary signal; this is
      // a fallback for cases where Service can't postMessage (e.g., previews).
      if (loadCount.current === 1) {
        setTimeout(() => {
          setState((prev) => (prev.phase === 'loading' ? { ...prev, phase: 'ready' } : prev));
        }, 3_000);
      }
    } else {
      // Token mode: first onLoad is /shell (processing token + redirect).
      // Next.js router.replace('/') is a soft nav — no second onLoad.
      // EQ_SERVICE_READY is the primary reveal signal (fires when ShellReadySignal
      // mounts in the dashboard layout). Fall back to 4s — TOKEN MODE has no OTP
      // round-trip so the shell-auth → dashboard path completes in ~2-3s.
      if (loadCount.current === 1) {
        setTimeout(() => {
          setState((prev) => {
            if (prev.phase !== 'loading') return prev;
            Sentry.addBreadcrumb({
              category: 'service-iframe',
              message: 'fallback reveal fired — EQ_SERVICE_READY not received in time',
              level: 'warning',
            });
            return { ...prev, phase: 'ready' };
          });
        }, 4_000);
      }
    }
  }

  const src = state.phase === 'loading' || state.phase === 'ready' ? state.src : null;

  return (
    <HubLayout iframe sidebarRecords={SIDEBAR_RECORDS}>
      <div className="eq-service-frame-wrap">
        {(state.phase === 'minting' || state.phase === 'loading') && (
          <div className="eq-loading">
            {state.phase === 'minting' ? 'Authorising EQ Service…' : 'Loading EQ Service…'}
          </div>
        )}
        {state.phase === 'error' && (
          <div className="eq-iframe-error-wrap">
            <EqError
              title="EQ Service didn't load"
              message={state.msg}
              retryLabel="Refresh page"
              onRetry={() => window.location.reload()}
            />
          </div>
        )}
        {src && (
          <iframe
            ref={iframeRef}
            className="eq-service-frame"
            style={state.phase !== 'ready' ? { visibility: 'hidden', position: 'absolute' } : undefined}
            title="EQ Service"
            src={src}
            onLoad={onIframeLoad}
            sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
            referrerPolicy="no-referrer"
            allow=""
          />
        )}
      </div>
    </HubLayout>
  );
}
