'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

// Module-level flag — stable across re-renders, scoped to this module
// (each React tree gets one init call per page load).
let phInitialised = false;

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (phInitialised) return;

    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
    const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID;
    const appEnv = process.env.NEXT_PUBLIC_APP_ENV;

    if (!key) return;

    posthog.init(key, {
      api_host: host,
      person_profiles: 'identified_only',
      // App Router uses client-side nav — use 'history_change' so pushState
      // transitions register as pageviews.
      capture_pageview: 'history_change',
      capture_pageleave: true,
      autocapture: true,
    });

    posthog.register({
      app: 'eq-service',
      app_env: appEnv,
    });

    // Fire session_started once per cold page-load. PostHog autocapture
    // + pageviews cover interaction data; this event exists so funnels
    // can count unique sessions consistently across apps.
    posthog.capture('session_started', {
      device_type: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile'
        : /iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : 'desktop',
      pwa_installed: (window.matchMedia?.('(display-mode: standalone)').matches) || false,
    });

    // Global error hooks — PostHog + Clarity both surface uncaught errors
    // natively, but capturing to an 'error_thrown' event gives us a
    // queryable error stream that's consistent with the Field app.
    //
    // Drop known third-party noise so it never reaches PostHog:
    //   - "Object Not Found Matching Id:N, MethodName:update, ParamCount:4"
    //     is injected by Microsoft Office / Outlook Click-to-Run scripts
    //     and famously dominates browser error streams. Not our code.
    //   - ResizeObserver loop messages are benign browser warnings.
    //   - Cross-origin "Script error." is opaque and unactionable.
    const NOISE_PATTERNS: RegExp[] = [
      /Object Not Found Matching Id:\d+, MethodName:update, ParamCount:\d+/,
      /^ResizeObserver loop (limit exceeded|completed with undelivered notifications)/,
      /^Script error\.?$/,
    ];
    const isNoise = (msg: string | null | undefined): boolean => {
      if (!msg) return false;
      return NOISE_PATTERNS.some((re) => re.test(msg));
    };

    window.addEventListener('error', (ev) => {
      const message = ev?.message ?? String(ev);
      if (isNoise(message)) return;
      posthog.capture('error_thrown', {
        context: 'window_error',
        message,
        filename: ev?.filename,
        lineno: ev?.lineno,
        colno: ev?.colno,
      });
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const message = ev?.reason?.message ?? String(ev?.reason ?? 'unknown');
      if (isNoise(message)) return;
      posthog.capture('error_thrown', {
        context: 'unhandled_promise',
        message,
      });
    });

    if (clarityId) {
      (function (c: any, l: Document, a: string, r: string, i: string) {
        c[a] =
          c[a] ||
          function () {
            (c[a].q = c[a].q || []).push(arguments);
          };
        const t = l.createElement(r) as HTMLScriptElement;
        t.async = true;
        t.src = 'https://www.clarity.ms/tag/' + i;
        const y = l.getElementsByTagName(r)[0];
        y.parentNode?.insertBefore(t, y);
      })(window, document, 'clarity', 'script', clarityId);
    }

    phInitialised = true;
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
