import { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { HubLayout } from '../components/HubLayout';
import { EqError } from '../components/EqError';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

// Embeds EQ Service (Next.js) as a Shell iframe.
//
// Two auth modes, selected by VITE_SERVICE_URL:
//
// COOKIE MODE (VITE_SERVICE_URL=https://service.eq.solutions)
//   The eq_shell_session cookie is Domain=.eq.solutions, so the browser
//   sends it automatically when the iframe loads service.eq.solutions.
//   Service's proxy.ts reads the cookie server-side and establishes a
//   Supabase session before rendering any HTML. No token minting, no
//   OTP round-trip, no client-visible auth loading. Activation steps:
//     1. Add service.eq.solutions as Netlify custom domain on eq-solves-service.
//     2. Set VITE_SERVICE_URL=https://service.eq.solutions in eq-shell Netlify env.
//     3. Set VITE_SERVICE_URL=https://service.eq.solutions in Netlify env.
//
// TOKEN MODE (fallback, any other VITE_SERVICE_URL value)
//   Legacy HMAC handshake: Shell mints a 60s token → embeds Service at
//   /shell#sh=<token> → Service's shell-auth function validates → OTP.
//   Kept as fallback for deploy previews and before the custom domain is live.

const SERVICE_URL = (import.meta.env.VITE_SERVICE_URL as string | undefined)
  ?? 'https://eq-solves-service.netlify.app';

// Cookie auth is active when Service is on the eq.solutions domain.
const COOKIE_AUTH = SERVICE_URL === 'https://service.eq.solutions'
  || SERVICE_URL.endsWith('.eq.solutions')
  || SERVICE_URL.endsWith('.eq.solutions/');

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
        const res = await fetch('/.netlify/functions/mint-service-iframe-token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
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
        const res = await fetch('/.netlify/functions/mint-service-iframe-token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
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
      // Fall back to revealing after 12s to cover the OTP round-trip.
      if (loadCount.current === 1) {
        setTimeout(() => {
          setState((prev) => (prev.phase === 'loading' ? { ...prev, phase: 'ready' } : prev));
        }, 12_000);
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
