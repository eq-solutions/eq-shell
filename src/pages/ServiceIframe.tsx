import { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { HubLayout } from '../components/HubLayout';

// Embeds EQ Service (Next.js) as a Shell iframe.
//
// Auth flow:
//   1. Shell mints a 60s HMAC token via mint-service-iframe-token.
//   2. Shell embeds Service at https://eq-solves-service.netlify.app/shell#sh=<token>
//   3. Service's /shell page reads the hash, calls /api/shell-auth.
//   4. shell-auth validates HMAC + calls Supabase admin.generateLink → OTP.
//   5. Service's /shell page calls supabase.auth.verifyOtp → session set.
//   6. Service redirects to / — app is live inside the iframe.
//
// Service signals readiness via postMessage ({ type: 'EQ_SERVICE_READY' })
// from its (app)/layout.tsx once the session and app shell are established.
// The onLoad fallback (2 events) catches preview deploys and any missed signals.
//
// 2026-05-27 — sidebar-alongside layout. Topbar removed; HubLayout with
// iframe prop keeps the sidebar visible while Service fills the content area.

const SERVICE_URL = 'https://eq-solves-service.netlify.app';

// Service is a Next.js SSR app — cold start + OTP round-trip can be slow.
// onLoad fires when the iframe completes any navigation (including the
// /shell → / redirect after successful auth). We use it to clear the
// loading overlay and to reset the no-load timeout.
const SERVICE_TIMEOUT_MS = 45_000;

type FrameState =
  | { phase: 'minting' }
  | { phase: 'loading'; src: string }
  | { phase: 'ready'; src: string }
  | { phase: 'error'; msg: string };

export default function ServiceIframe() {
  const [state, setState] = useState<FrameState>({ phase: 'minting' });
  // loadCount tracks iframe onLoad events. The /shell page fires once
  // on initial load; the redirect to / fires again. Two events = auth
  // round-trip completed (success or failure — we can't distinguish
  // cross-origin, but at least we know Service responded).
  // Used as fallback when the postMessage readiness signal doesn't fire.
  const loadCount = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
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
            // base64 characters (+, /, =) are safe in URL hash fragments —
            // no encoding needed, and Service reads the hash without decoding.
            src: `${SERVICE_URL}/shell#sh=${token}`,
          });
        }
      } catch {
        if (!cancelled) setState({ phase: 'error', msg: 'Network error reaching EQ Service. Check your connection.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Timeout if the iframe never fires onLoad (DNS failure, Netlify down,
  // etc.). Resets whenever onLoad fires so slow-but-alive instances
  // don't trip it.
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

  // Prefer postMessage over the onLoad count — Service signals readiness
  // explicitly once the session and app layout are established.
  // Falls back to the onLoad count (below) if the message never fires.
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

  // Respond to token refresh requests from the Service iframe.
  useEffect(() => {
    const expectedOrigin = import.meta.env.VITE_SERVICE_URL as string | undefined;
    async function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if ((ev.data as Record<string, unknown>).type !== 'REQUEST_SHELL_TOKEN') return;
      if (expectedOrigin) {
        if (ev.origin !== expectedOrigin) return;
      } else {
        if (import.meta.env.DEV) {
          console.warn('[ServiceIframe] VITE_SERVICE_URL not set — accepting REQUEST_SHELL_TOKEN from any origin');
        }
      }
      const origin = expectedOrigin ?? ev.origin;
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
    // Fallback: reveal after the FIRST onLoad once the auth round-trip has had
    // time to complete. The first onLoad is the /shell page itself. Next.js's
    // router.replace('/') is a soft nav that does NOT fire a second onLoad, so
    // the old ">= 2" threshold never triggered. We use a 12s delay after the
    // first onLoad — enough for OTP verification + server render — before
    // revealing the iframe. EQ_SERVICE_READY (the primary signal) fires much
    // faster when it works; this is a last-resort fallback.
    if (loadCount.current === 1) {
      setTimeout(() => {
        setState((prev) => (prev.phase === 'loading' ? { ...prev, phase: 'ready' } : prev));
      }, 12_000);
    }
  }

  const src = state.phase === 'loading' || state.phase === 'ready' ? state.src : null;

  return (
    <HubLayout iframe>
      <div className="eq-service-frame-wrap">
        {(state.phase === 'minting' || state.phase === 'loading') && (
          <div className="eq-loading">
            {state.phase === 'minting' ? 'Authorising EQ Service…' : 'Loading EQ Service…'}
          </div>
        )}
        {state.phase === 'error' && (
          <div className="eq-error" role="alert">{state.msg}</div>
        )}
        {src && (
          <iframe
            ref={iframeRef}
            className="eq-service-frame"
            style={state.phase !== 'ready' ? { visibility: 'hidden', position: 'absolute' } : undefined}
            title="EQ Service"
            src={src}
            onLoad={onIframeLoad}
            // allow-same-origin so Service's cookies + localStorage work.
            // allow-scripts required for the Next.js app to run.
            // allow-forms for any onsite input forms.
            // allow-downloads for run-sheet + report docx exports.
            sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
            referrerPolicy="no-referrer"
            allow=""
          />
        )}
      </div>
    </HubLayout>
  );
}
