// Shared HMAC token helpers for the EQ Shell Netlify functions.
//
// Two token shapes are produced here:
//
//   1. Session cookie payload — { user_id, tenant_id, exp }
//      Set by shell-login, validated by verify-shell-session.
//      Lives in the eq_shell_session cookie on .eq.solutions.
//
//   2. Iframe handoff token — { kind: 'shell-token', name, role, exp }
//      Minted by mint-iframe-token, validated by EQ Field's
//      /.netlify/functions/verify-pin (action="verify-shell-token").
//      Must match EQ Field's verifyShellToken() shape exactly —
//      see Field-side PR #106 (Phase 1.C) for the contract.
//
// Both shapes use the same wire format: base64(JSON payload) + "." + hex(HMAC-SHA256).
// HMAC key is EQ_SECRET_SALT — MUST be the SAME value as eq-solves-field
// uses, or the iframe handshake won't validate.

import { createHmac } from 'node:crypto';

const SECRET_SALT = process.env.EQ_SECRET_SALT ?? '';

export interface SessionPayload {
  user_id: string;
  tenant_id: string;
  exp: number;
}

export interface ShellTokenPayload {
  kind: 'shell-token';
  name: string;
  role: 'staff' | 'supervisor';
  exp: number;
}

function sign(payloadJson: string): string {
  return createHmac('sha256', SECRET_SALT).update(payloadJson).digest('hex');
}

export function signSessionToken(payload: SessionPayload): string {
  const json = JSON.stringify(payload);
  const sig = sign(json);
  return Buffer.from(json).toString('base64') + '.' + sig;
}

export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;
    const json = Buffer.from(b64, 'base64').toString();
    const expected = sign(json);
    if (expected !== sig) return null;
    const data = JSON.parse(json) as SessionPayload;
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    if (!data.user_id || !data.tenant_id) return null;
    return data;
  } catch {
    return null;
  }
}

export function signShellToken(payload: ShellTokenPayload): string {
  const json = JSON.stringify(payload);
  const sig = sign(json);
  return Buffer.from(json).toString('base64') + '.' + sig;
}

// Parses the eq_shell_session cookie value out of a Cookie header.
// Cookie header looks like: "foo=bar; eq_shell_session=<token>; baz=qux".
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  const pairs = header.split(/;\s*/);
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq);
    if (name === 'eq_shell_session') {
      return pair.slice(eq + 1);
    }
  }
  return null;
}

export function hasSecretSalt(): boolean {
  return !!SECRET_SALT;
}
