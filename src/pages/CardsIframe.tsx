// Embeds the EQ Cards Flutter web build as an iframe.
//
// Auth flow (OTP path — replaces broken setSession(custom_jwt)):
//   1. Shell loads the iframe with ?shell=1.
//   2. Flutter detects ?shell=1 with no session, sends REQUEST_SHELL_TOKEN.
//   3. This handler calls mint-cards-otp (ensureAuthUser + generateLink).
//   4. Posts SHELL_TOKEN_RESPONSE { token_hash } back to Flutter.
//   5. Flutter calls auth.verifyOTP(tokenHash, OtpType.magiclink) — GoTrue
//      creates a real auth.sessions row with refresh_token. Session established.
//
// Why not setSession(custom_jwt): gotrue_dart 2.20.0+ calls getUser() inside
// setSession, which rejects JWTs with no auth.sessions row → session_not_found.
// The token_hash path creates a real GoTrue session that survives refresh.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { HubLayout } from '../components/HubLayout';
import { EqError } from '../components/EqError';
import { defaultSidebarRecords } from '../lib/sidebarConfig';

const SIDEBAR_RECORDS = defaultSidebarRecords();

const CARDS_URL = 'https://cards.eq.solutions/';
const LOAD_TIMEOUT_MS = 30_000;

type Phase = 'loading' | 'ready' | 'load-error';

export default function CardsIframe() {
  const [phase, setPhase] = useState<Phase>('loading');
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
    setPhase('loading');
    setAttempt((n) => n + 1);
  }, []);

  // Load timeout — if Flutter never fires onLoad within 30s something is wrong.
  useEffect(() => {
    if (phase !== 'loading') return;
    loadTimerRef.current = setTimeout(() => {
      setPhase('load-error');
      Sentry.captureMessage(
        `Cards iframe did not fire onLoad within ${LOAD_TIMEOUT_MS / 1000}s`,
        { level: 'error' },
      );
    }, LOAD_TIMEOUT_MS);
    return clearLoadTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, attempt]);

  // Handle REQUEST_SHELL_TOKEN from Cards — both initial load and 15-min refresh.
  useEffect(() => {
    const cardsOrigin = new URL(CARDS_URL).origin;
    const expectedOrigin = (import.meta.env.VITE_CARDS_URL as string | undefined) ?? cardsOrigin;

    async function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if ((ev.data as Record<string, unknown>).type !== 'REQUEST_SHELL_TOKEN') return;
      if (ev.origin !== expectedOrigin) return;

      // Use ev.source (the live contentWindow of the originating iframe) rather
      // than iframeRef.current?.contentWindow. iframeRef can be stale/null
      // during the 12-min re-mint cycle if the iframe has re-mounted between
      // REQUEST_SHELL_TOKEN and our async response — ev.source is always valid.
      const replyTarget = ev.source as Window | null;

      try {
        const res = await fetch('/.netlify/functions/mint-cards-otp', {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          replyTarget?.postMessage(
            { type: 'SHELL_TOKEN_RESPONSE', error: 'mint-failed' },
            expectedOrigin,
          );
          Sentry.captureMessage(`mint-cards-otp returned ${res.status}`, { level: 'error' });
          return;
        }
        const { token_hash } = (await res.json()) as { token_hash: string };
        replyTarget?.postMessage(
          { type: 'SHELL_TOKEN_RESPONSE', token_hash },
          expectedOrigin,
        );
      } catch (e) {
        replyTarget?.postMessage(
          { type: 'SHELL_TOKEN_RESPONSE', error: 'mint-failed' },
          expectedOrigin,
        );
        Sentry.captureException(e, { tags: { surface: 'cards-iframe-token' } });
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const onIframeLoad = () => {
    clearLoadTimer();
    setPhase('ready');
  };

  if (phase === 'load-error') {
    return (
      <HubLayout iframe sidebarRecords={SIDEBAR_RECORDS}>
        <div className="eq-iframe-error-wrap">
          <EqError
            title="EQ Cards didn't load"
            message="It took too long to open. Try again — if it keeps happening, reload the page."
            onRetry={retry}
          />
        </div>
      </HubLayout>
    );
  }

  return (
    <HubLayout iframe sidebarRecords={SIDEBAR_RECORDS}>
      {phase === 'loading' && (
        <div className="eq-loading eq-loading--overlay" aria-busy="true">
          Opening EQ Cards…
        </div>
      )}
      <iframe
        ref={iframeRef}
        key={attempt}
        className="eq-cards-frame"
        style={{ flex: 1, minHeight: 0 }}
        title="EQ Cards"
        src={`${CARDS_URL}auth/handoff?shell=1`}
        sandbox="allow-same-origin allow-scripts allow-forms allow-downloads"
        referrerPolicy="no-referrer"
        allow=""
        onLoad={onIframeLoad}
      />
    </HubLayout>
  );
}
