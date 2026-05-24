import { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { Topbar } from '../components/Topbar';

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
// Because Service is a full Next.js app (not a static site), we get a
// proper browser-side redirect once the session is established. No
// postMessage contract is needed — Service handles everything internally.

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
  const loadCount = useRef(0);

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

  function onIframeLoad() {
    loadCount.current += 1;
    // Reveal the iframe after the first load so the /shell auth page
    // isn't briefly visible before the redirect completes.
    if (loadCount.current >= 2) {
      setState((prev) => (prev.phase === 'loading' ? { ...prev, phase: 'ready' } : prev));
    }
  }

  const src = state.phase === 'loading' || state.phase === 'ready' ? state.src : null;

  return (
    <>
      <Topbar />
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
    </>
  );
}
