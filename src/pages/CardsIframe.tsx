// Embeds the EQ Cards Flutter web build as an iframe.
//
// Auth flow: Shell mints a Supabase JWT via mint-cards-iframe-token and
// injects it into the iframe src hash (#sh=<jwt>). The Flutter app reads
// the hash, calls setSession(), and is authenticated against canonical.
//
// Cookie-based auth (shell-verify on cards.eq.solutions) was attempted
// 2026-05-28 but reverted — the shell-verify function hasn't been
// deployed to cards.eq.solutions yet. Revert to hash approach until
// the Flutter app is updated to send REQUEST_SHELL_TOKEN on initial load.
//
// JWT refresh: when the 15-min JWT expires, Flutter posts REQUEST_SHELL_TOKEN.
// Shell mints a fresh JWT via mint-cards-iframe-token and responds with
// SHELL_TOKEN_RESPONSE so Flutter can call setSession() again.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { HubLayout } from '../components/HubLayout';

const CARDS_URL = 'https://cards.eq.solutions/';
const LOAD_TIMEOUT_MS = 30_000;

type MintPhase =
  | 'minting'       // fetching token
  | 'loading'       // token OK, iframe injected, waiting for onLoad
  | 'ready'         // iframe onLoad fired
  | 'mint-error'    // token fetch failed (network or !res.ok)
  | 'load-timeout'; // iframe injected but onLoad never fired

export default function CardsIframe() {
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<MintPhase>('minting');
  const [attempt, setAttempt] = useState(0);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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

  // JWT refresh — respond to REQUEST_SHELL_TOKEN from the Cards iframe.
  useEffect(() => {
    // Fail closed: use CARDS_URL origin as fallback so the handler
    // never silently accepts messages from arbitrary origins.
    const cardsOrigin = new URL(CARDS_URL).origin;
    const expectedOrigin = (import.meta.env.VITE_CARDS_URL as string | undefined) ?? cardsOrigin;
    async function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if ((ev.data as Record<string, unknown>).type !== 'REQUEST_SHELL_TOKEN') return;
      if (ev.origin !== expectedOrigin) return;
      const origin = expectedOrigin;
      try {
        const res = await fetch('/.netlify/functions/mint-cards-iframe-token', {
          method: 'POST',
          credentials: 'include',
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

  const onIframeLoad = () => {
    clearLoadTimer();
    setPhase('ready');
  };

  if (phase === 'mint-error' || phase === 'load-timeout') {
    const msg =
      phase === 'mint-error'
        ? "Couldn't open EQ Cards. Check your connection and try again."
        : 'EQ Cards took too long to load. Try again — if the problem persists, reload the page.';
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

  if (phase === 'minting') {
    return (
      <HubLayout iframe>
        <div className="eq-loading">Opening EQ Cards…</div>
      </HubLayout>
    );
  }

  return (
    <HubLayout iframe>
      {phase === 'loading' && (
        <div className="eq-loading eq-loading--overlay" aria-busy="true">
          Opening EQ Cards…
        </div>
      )}
      {iframeSrc && (
        <iframe
          ref={iframeRef}
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
