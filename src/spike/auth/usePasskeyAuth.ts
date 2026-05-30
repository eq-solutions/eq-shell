/**
 * SPIKE - Passkey (WebAuthn) enrollment + sign-in hook.
 *
 * Demonstrates:
 *   1. Pre-flight WebAuthn device detection.
 *   2. Magic-link (email OTP) as the baseline first-login credential.
 *   3. Passkey enrollment via Supabase MFA webauthn factor (beta API).
 *   4. Passkey sign-in via supabase.auth.signInWithPasskey (beta API).
 *   5. Reading the JWT app_metadata claims (eq_role, tenant_id, is_platform_admin)
 *      and mapping them through @eq-solutions/roles can().
 *
 * NOTE: Supabase passkey API is in beta as of 2026-05-28. Method signatures
 * may change before GA. Targets @supabase/supabase-js v2.106.0.
 *
 * ISOLATION: This hook only imports from spike/auth/supabaseAuthClient and
 * @eq-solutions/roles. It does NOT touch session.ts, supabase.ts,
 * supabaseJwt.ts, or any Netlify function. The live auth path is untouched.
 */

import { useState, useCallback, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { can, type EqRole, type PermKey } from '@eq-solutions/roles';
import { getSpikeSupabaseClient } from './supabaseAuthClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PasskeyStep =
  | 'idle'
  | 'magic_link_sent'
  | 'authenticated'
  | 'enrolling'
  | 'enrolled'
  | 'signing_in'
  | 'error';

/** JWT custom claims injected by the Supabase Custom Access Token Hook. */
export interface SpikeJwtClaims {
  eq_role: EqRole | null;
  tenant_id: string | null;
  is_platform_admin: boolean;
}

export interface PasskeyAuthState {
  step: PasskeyStep;
  session: Session | null;
  claims: SpikeJwtClaims | null;
  error: string | null;
  webauthnSupported: boolean;
}

export interface PasskeyAuthActions {
  sendMagicLink: (email: string) => Promise<void>;
  enrollPasskey: () => Promise<void>;
  signInWithPasskey: (email: string) => Promise<void>;
  checkCan: (perm: PermKey) => boolean;
  signOut: () => Promise<void>;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// WebAuthn support detection
// ---------------------------------------------------------------------------

/**
 * Detects whether this browser/device supports WebAuthn platform authenticators.
 * Per the spike design (section 3.2), if not supported we skip enrollment silently.
 */
async function detectWebAuthnSupport(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !window.PublicKeyCredential ||
    typeof navigator.credentials?.create !== 'function'
  ) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// JWT claims extraction
// ---------------------------------------------------------------------------

/**
 * Decodes app_metadata claims from a Supabase access token.
 * These are injected by the Custom Access Token Hook (see AUTH-SPIKE-README.md).
 * Returns null if the hook is not yet live or the token is malformed.
 */
function extractClaims(accessToken: string): SpikeJwtClaims | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as Record<string, unknown>;
    const meta = (payload.app_metadata ?? {}) as Record<string, unknown>;
    return {
      eq_role: (typeof meta.eq_role === 'string' ? meta.eq_role : null) as EqRole | null,
      tenant_id: typeof meta.tenant_id === 'string' ? meta.tenant_id : null,
      is_platform_admin: meta.is_platform_admin === true,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const INITIAL_STATE: PasskeyAuthState = {
  step: 'idle',
  session: null,
  claims: null,
  error: null,
  webauthnSupported: false,
};

export function usePasskeyAuth(): PasskeyAuthState & PasskeyAuthActions {
  const [state, setState] = useState<PasskeyAuthState>(INITIAL_STATE);

  useEffect(() => {
    detectWebAuthnSupport()
      .then((supported) => setState((prev) => ({ ...prev, webauthnSupported: supported })))
      .catch(() => { /* non-fatal */ });
  }, []);

  // Subscribe to Supabase Auth state changes (handles magic link redirect).
  useEffect(() => {
    const sb = getSpikeSupabaseClient();
    if (!sb) return;
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      if (session) {
        const claims = extractClaims(session.access_token);
        setState((prev) => ({ ...prev, step: 'authenticated', session, claims, error: null }));
      } else {
        setState((prev) => ({ ...prev, step: 'idle', session: null, claims: null }));
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  /**
   * Step 1 - Send a magic link to the email address.
   * Magic link is the baseline credential. Passkey enrollment is offered
   * after successful first login (per AUTH-SPIKE-README.md section 3.2).
   */
  const sendMagicLink = useCallback(async (email: string) => {
    const sb = getSpikeSupabaseClient();
    if (!sb) {
      setState((prev) => ({
        ...prev,
        step: 'error',
        error: 'Spike not configured. Add VITE_SPIKE_SUPABASE_URL and VITE_SPIKE_SUPABASE_ANON_KEY to .env.local.',
      }));
      return;
    }
    setState((prev) => ({ ...prev, step: 'idle', error: null }));
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) {
      setState((prev) => ({ ...prev, step: 'error', error: error.message }));
      return;
    }
    setState((prev) => ({ ...prev, step: 'magic_link_sent' }));
  }, []);

  /**
   * Step 2 - Enroll a passkey for the authenticated user.
   *
   * Uses the Supabase beta MFA webauthn enrollment API. The SDK handles the full
   * WebAuthn ceremony (challenge generation, authenticator interaction, credential
   * registration).
   *
   * Must run in a top-level secure context (https or localhost). Will fail inside
   * an iframe. The /auth-spike route is top-level, so this is satisfied.
   *
   * User-facing copy rule: never say "passkey", "WebAuthn", "FIDO2".
   */
  const enrollPasskey = useCallback(async () => {
    const sb = getSpikeSupabaseClient();
    if (!sb || !state.session) {
      setState((prev) => ({
        ...prev,
        step: 'error',
        error: 'Sign in first before setting up faster sign-in.',
      }));
      return;
    }
    if (!state.webauthnSupported) {
      setState((prev) => ({
        ...prev,
        step: 'error',
        error: 'This device does not support fingerprint or face sign-in.',
      }));
      return;
    }
    setState((prev) => ({ ...prev, step: 'enrolling', error: null }));
    try {
      // Supabase passkey beta API. Cast because webauthn factorType types
      // are still behind a beta flag in the SDK type definitions.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb.auth.mfa as any).enroll({ factorType: 'webauthn' });
      if (error) {
        setState((prev) => ({
          ...prev,
          step: 'error',
          error: "Couldn't set up sign-in on this device. Try again from Settings.",
        }));
        return;
      }
      setState((prev) => ({ ...prev, step: 'enrolled' }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        step: 'error',
        error: err instanceof Error ? err.message : 'Setup failed - see browser console.',
      }));
    }
  }, [state.session, state.webauthnSupported]);

  /**
   * Sign in with a previously enrolled passkey.
   *
   * Uses the Supabase beta signInWithPasskey API. The browser presents the
   * native authenticator chooser (Touch ID, Face ID, Windows Hello, device PIN).
   *
   * Set autocomplete="webauthn" on the email input to enable browser Conditional
   * UI (Chrome 108+, Safari 16+, Firefox 122+).
   */
  const signInWithPasskey = useCallback(async (email: string) => {
    const sb = getSpikeSupabaseClient();
    if (!sb) {
      setState((prev) => ({ ...prev, step: 'error', error: 'Spike not configured.' }));
      return;
    }
    setState((prev) => ({ ...prev, step: 'signing_in', error: null }));
    try {
      // Supabase beta passkey sign-in API.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (sb.auth as any).signInWithPasskey({ email });
      if (error) {
        setState((prev) => ({
          ...prev,
          step: 'error',
          error: "Couldn't sign in with your fingerprint. Try your email link instead.",
        }));
        return;
      }
      const session = (data as { session?: Session } | null)?.session ?? null;
      if (session) {
        const claims = extractClaims(session.access_token);
        setState((prev) => ({ ...prev, step: 'authenticated', session, claims, error: null }));
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        step: 'error',
        error: err instanceof Error ? err.message : 'Sign-in failed.',
      }));
    }
  }, []);

  /**
   * Permission check via @eq-solutions/roles can().
   * Reads eq_role and is_platform_admin from the decoded JWT claims.
   * Returns false when no session or claims are present.
   */
  const checkCan = useCallback(
    (perm: PermKey): boolean => {
      if (!state.claims?.eq_role) return false;
      return can(state.claims.eq_role, perm, { isPlatformAdmin: state.claims.is_platform_admin });
    },
    [state.claims],
  );

  const signOut = useCallback(async () => {
    const sb = getSpikeSupabaseClient();
    if (sb) await sb.auth.signOut();
    setState(INITIAL_STATE);
  }, []);

  const reset = useCallback(() => setState(INITIAL_STATE), []);

  return { ...state, sendMagicLink, enrollPasskey, signInWithPasskey, checkCan, signOut, reset };
}