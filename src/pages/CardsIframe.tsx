// Embeds the EQ Cards Flutter web build as an iframe. Two modes:
//
//   1. PRE-UNIT-4 (today): Cards' own auth boundary; the user signs in
//      via email OTP independently the first time. No token passed.
//
//   2. POST-UNIT-4 (when Cards' Flutter flip ships): we mint a Supabase
//      JWT via /.netlify/functions/mint-cards-iframe-token and pass it
//      via URL hash (#sh=<jwt>). The Cards app reads the hash on load,
//      sets the Supabase session, and is authenticated against
//      canonical with the same tenant + role + platform_admin claims
//      the shell carries.
//
// The mode is controlled by the CARDS_USE_SHELL_SSO compile-time flag.
// When the Flutter flip ships, set CARDS_USE_SHELL_SSO=true (or remove
// the flag and the legacy path entirely).
//
// Spec: eq/cards/canonical-migration/plan.md §Unit 4 + §Unit 5.
//
// 2026-05-27 — sidebar-alongside layout. Topbar removed; HubLayout with
// iframe prop keeps the sidebar visible while Cards fills the content area.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { HubLayout } from '../components/HubLayout';

const CARDS_URL = 'https://cards.eq.solutions/';

// Cards Unit 4 shipped 2026-05-21: Cards Flutter app reads the
// shell-minted JWT from the iframe URL hash and calls setSession.
// Cards' own email-OTP path is gone.
const CARDS_USE_SHELL_SSO = true;

// How long to wait for the iframe to fire its onLoad event before
// declaring a timeout. Flutter web cold-start (SW install + Dart init)
// runs 5-15s on a fast connection; 30s matches Field's generous cap.
const LOAD_TIMEOUT_MS = 30_000;

type MintPhase =
  | 'minting'       // fetching token
  | 'loading'       // token OK, iframe injected, waiting for onLoad
  | 'ready'         // iframe onLoad fired
  | 'mint-error'    // token fetch failed (network or !res.ok)
  | 'load-timeout'; // iframe injected but onLoad never fired

export default function CardsIframe() {
  const [iframeSrc, setIframeSrc] = useState<string | null>(
    CARDS_USE_SHELL_SSO ? null : CARDS_URL,
  );
  const [phase, setPhase] = useState<MintPhase>(
    CARDS_USE_SHELL_SSO ? 'minting' : 'ready',
  );
  // Incremented by the Retry button to force useEffect re-run.
  const [attempt, setAttempt] = useState(0);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoadTimer = () => {
    if (loadTimerRef.current !== null) {
      clearTimeout(loadTimerRef.current);
      loadTimerRef.current = null;
    }
  };

  const retry = useCallback(() => {
    clearLoadTimer();
    setIframeSrc(null);
    setPhase('minting');
    setAttempt((n) => n + 1);
  }, []);

  // Mint the token and set the iframe src.
  useEffect(() => {
    if (!CARDS_USE_SHELL_SSO) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/mint-cards-iframe-token', {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          if (!cancelled) {
            setPhase('mint-error');
            Sentry.captureMessage(
              `Cards iframe token mint failed — HTTP ${res.status}`,
              { level: 'error' },
            );
          }
          return;
        }
        const { token } = (await res.json()) as { token: string; exp: number };
        if (cancelled) return;
        setIframeSrc(`${CARDS_URL}auth/handoff#sh=${encodeURIComponent(token)}`);
        setPhase('loading');
      } catch (e) {
        if (!cancelled) {
          setPhase('mint-error');
          Sentry.captureException(e, { tags: { surface: 'cards-iframe-mint' } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Load timeout — start counting once the iframe src is injected.
  useEffect(() => {
    if (phase !== 'loading') return;
    loadTimerRef.current = setTimeout(() => {
      setPhase('load-timeout');
      Sentry.captureMessage(
        `Cards iframe did not fire onLoad within ${LOAD_TIMEOUT_MS / 1000}s`,
        { level: 'error' },
      );
    }, LOAD_TIMEOUT_MS);
    return clearLoadTimer;
  }, [phase]);

  const onIframeLoad = () => {
    clearLoadTimer();
    setPhase('ready');
  };

  // Error + retry states — shown before the iframe is mounted.
  if (phase === 'mint-error' || phase === 'load-timeout') {
    const msg =
      phase === 'mint-error'
        ? "Couldn't open EQ Cards. Check your connection and try again."
        : "EQ Cards took too long to load. Try again — if the problem persists, reload the page.";
    return (
      <HubLayout iframe>
        <div
          className="eq-iframe-error"
          role="alert"
          style={{ margin: 28, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}
        >
          <p style={{ margin: 0, color: '#1A1A2E' }}>{msg}</p>
          <button
            type="button"
            className="eq-btn eq-btn--sm"
            onClick={retry}
            style={{ alignSelf: 'flex-start' }}
          >
            Try again
          </button>
        </div>
      </HubLayout>
    );
  }

  // Token fetch in progress.
  if (phase === 'minting') {
    return (
      <HubLayout iframe>
        <div className="eq-loading">Opening EQ Cards…</div>
      </HubLayout>
    );
  }

  // Iframe src is set — render it. A brief loading scrim overlays while
  // the Flutter app boots; once onLoad fires it disappears.
  return (
    <HubLayout iframe>
      {phase === 'loading' && (
        <div className="eq-loading eq-loading--overlay" aria-busy="true">
          Opening EQ Cards…
        </div>
      )}
      {iframeSrc && (
        <iframe
          className="eq-cards-frame"
          style={{ flex: 1, minHeight: 0 }}
          title="EQ Cards"
          src={iframeSrc}
          sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
          referrerPolicy="no-referrer"
          allow=""
          onLoad={onIframeLoad}
        />
      )}
    </HubLayout>
  );
}
