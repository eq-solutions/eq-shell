import { useEffect, useState } from 'react';
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

type FrameState =
  | { phase: 'minting' }
  | { phase: 'ready'; src: string }
  | { phase: 'error'; msg: string };

export default function ServiceIframe() {
  const [state, setState] = useState<FrameState>({ phase: 'minting' });

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
            phase: 'ready',
            src: `${SERVICE_URL}/shell#sh=${encodeURIComponent(token)}`,
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

  return (
    <>
      <Topbar />
      <div className="eq-service-frame-wrap">
        {state.phase === 'minting' && (
          <div className="eq-loading">Authorising EQ Service…</div>
        )}
        {state.phase === 'error' && (
          <div className="eq-error" role="alert">{state.msg}</div>
        )}
        {state.phase === 'ready' && (
          <iframe
            className="eq-service-frame"
            title="EQ Service"
            src={state.src}
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
