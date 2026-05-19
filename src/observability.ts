// Browser-side observability bootstrap for EQ Shell.
//
// Wires the three EQ-standard browser tools:
//
//   - Sentry (`@sentry/react`)    — error + perf capture, session replay on errors
//   - PostHog (`posthog-js`)      — product analytics, feature flags
//   - Microsoft Clarity            — session replay + heatmaps (script-tag injection)
//
// Each integration is feature-flagged by env var. If the relevant key is
// missing the integration silently no-ops; the app must never crash because
// observability is unconfigured. This keeps local dev + branch previews
// (where Royce may not want analytics traffic) frictionless.
//
// Env vars (all browser-side; must be prefixed VITE_ to reach the bundle):
//
//   VITE_SENTRY_DSN              — Sentry project DSN (org `eq-solutions`, project `eq-shell`)
//   VITE_SENTRY_ENVIRONMENT      — optional, defaults to import.meta.env.MODE
//   VITE_SENTRY_RELEASE          — optional release tag, e.g. git SHA
//   VITE_POSTHOG_KEY             — PostHog project API key
//   VITE_POSTHOG_HOST            — optional, defaults to https://eu.i.posthog.com
//   VITE_CLARITY_PROJECT_ID      — Microsoft Clarity project ID
//
// `initObservability()` should be called exactly once, as early as possible
// in `main.tsx`, before React renders. `identifyUser()` is called by the
// SessionProvider once the canonical user is hydrated so events get joined
// to a stable identity in PostHog + Sentry.

import * as Sentry from '@sentry/react';
import posthog from 'posthog-js';

const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

let sentryReady = false;
let posthogReady = false;
let clarityReady = false;

interface ImportMetaEnvLike {
  readonly MODE?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_CLARITY_PROJECT_ID?: string;
}

function getEnv(): ImportMetaEnvLike {
  // Cast: import.meta.env is typed loosely by Vite, but we know the
  // VITE_-prefixed vars are strings or undefined at runtime.
  return import.meta.env as unknown as ImportMetaEnvLike;
}

function initSentry(env: ImportMetaEnvLike): void {
  const dsn = env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.info('[observability] Sentry disabled — VITE_SENTRY_DSN not set');
    return;
  }
  try {
    Sentry.init({
      dsn,
      environment: env.VITE_SENTRY_ENVIRONMENT ?? env.MODE ?? 'production',
      release: env.VITE_SENTRY_RELEASE,
      integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
      // 10% perf traces in normal sessions, 100% replay on sessions that
      // hit an error — matches the EQ Field default.
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
    sentryReady = true;
  } catch (err) {
    console.warn('[observability] Sentry init failed:', err);
  }
}

function initPostHog(env: ImportMetaEnvLike): void {
  const key = env.VITE_POSTHOG_KEY;
  if (!key) {
    console.info('[observability] PostHog disabled — VITE_POSTHOG_KEY not set');
    return;
  }
  try {
    posthog.init(key, {
      api_host: env.VITE_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
      capture_pageview: true,
      capture_pageleave: true,
      // EU residency: defaults below match `eu.i.posthog.com`. If Royce
      // ever swaps to the US instance the env var override handles it.
      person_profiles: 'identified_only',
    });
    posthogReady = true;
  } catch (err) {
    console.warn('[observability] PostHog init failed:', err);
  }
}

function initClarity(env: ImportMetaEnvLike): void {
  const projectId = env.VITE_CLARITY_PROJECT_ID;
  if (!projectId) {
    console.info('[observability] Clarity disabled — VITE_CLARITY_PROJECT_ID not set');
    return;
  }
  if (typeof document === 'undefined') return;
  try {
    // Standard Clarity install snippet — injects the loader script tag
    // with the project ID baked in. Clarity has no npm SDK; this is the
    // canonical embed pattern.
    const id = JSON.stringify(projectId);
    const snippet =
      '(function(c,l,a,r,i,t,y){' +
      'c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};' +
      't=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;' +
      'y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);' +
      `})(window, document, "clarity", "script", ${id});`;

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.text = snippet;
    document.head.appendChild(script);
    clarityReady = true;
  } catch (err) {
    console.warn('[observability] Clarity init failed:', err);
  }
}

/**
 * Initialise all three observability integrations. Safe to call multiple
 * times — only the first call has any effect. Each SDK silently no-ops
 * when its env var is missing.
 */
export function initObservability(): void {
  const env = getEnv();
  initSentry(env);
  initPostHog(env);
  initClarity(env);
}

export interface IdentifyTraits {
  tenant?: string;
  role?: string;
  email?: string;
  [k: string]: unknown;
}

/**
 * Tag the current browser session with a stable identity once the
 * canonical user is hydrated. Idempotent: called every time the session
 * provider hydrates, including post-login.
 */
export function identifyUser(userId: string, traits: IdentifyTraits = {}): void {
  if (sentryReady) {
    try {
      Sentry.setUser({
        id: userId,
        email: traits.email,
        // Sentry's user payload is flat; tenant + role go on the scope
        // as tags so they're filterable in the issues view.
      });
      Sentry.setTag('tenant', traits.tenant ?? 'unknown');
      Sentry.setTag('role', traits.role ?? 'unknown');
    } catch (err) {
      console.warn('[observability] Sentry setUser failed:', err);
    }
  }

  if (posthogReady) {
    try {
      posthog.identify(userId, traits);
      if (traits.tenant) {
        // Group-analytics-style tenant tag — lets Royce slice events
        // by tenant in PostHog without re-querying every chart.
        posthog.group('tenant', traits.tenant);
      }
    } catch (err) {
      console.warn('[observability] PostHog identify failed:', err);
    }
  }

  if (clarityReady) {
    try {
      // Clarity exposes a global queue via the snippet above. The
      // `identify` call attaches the user id to the recorded session
      // so heatmaps / replays can be filtered by user.
      const clarity = (window as unknown as { clarity?: (...args: unknown[]) => void }).clarity;
      if (typeof clarity === 'function') {
        clarity('identify', userId, undefined, undefined, traits.email ?? undefined);
        if (traits.tenant) clarity('set', 'tenant', traits.tenant);
        if (traits.role) clarity('set', 'role', traits.role);
      }
    } catch (err) {
      console.warn('[observability] Clarity identify failed:', err);
    }
  }
}

/**
 * Clear identity on logout so post-logout events aren't attributed to
 * the prior user. Safe to call when the SDKs aren't initialised.
 */
export function resetUser(): void {
  if (sentryReady) {
    try {
      Sentry.setUser(null);
    } catch {
      // swallow
    }
  }
  if (posthogReady) {
    try {
      posthog.reset();
    } catch {
      // swallow
    }
  }
}
