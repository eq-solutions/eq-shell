// AES-256-GCM helpers for encrypting per-tenant Supabase service-role keys
// stored in shell_control.tenant_routing.
//
// Algorithm: AES-256-GCM
// - Authenticated encryption: tampered ciphertext fails verification at decrypt time
// - 96-bit IV (per NIST SP 800-38D recommendation for GCM)
// - 128-bit auth tag
// - Master key: 32 raw bytes, hex-encoded, lives in TENANT_ROUTING_MASTER_KEY env var
//
// Threat model: the database may be compromised independently of the Shell
// runtime. With encrypted-at-rest service-role keys + the master key held only
// in Netlify env, a DB-only compromise yields useless ciphertext. A Shell
// compromise is game-over but no worse than today (Shell already holds
// SUPABASE_SERVICE_ROLE_KEY, EQ_SECRET_SALT, etc. in env).
//
// Architecture: docs/ARCHITECTURE-V2.md "tenant_routing — the key new piece"

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;        // AES-256 requires a 256-bit (32-byte) key
const IV_LENGTH_BYTES = 12;         // 96 bits, recommended for GCM
const AUTH_TAG_LENGTH_BYTES = 16;   // 128 bits

export interface EncryptedSecret {
  ciphertext: string;  // hex
  iv: string;          // hex
  tag: string;         // hex
}

function getMasterKey(): Buffer {
  const hex = process.env.TENANT_ROUTING_MASTER_KEY;
  if (!hex) {
    throw new Error(
      'Server misconfigured — TENANT_ROUTING_MASTER_KEY env var is required ' +
      'for tenant routing encryption. Generate with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  // Allow whitespace in env var value (Netlify UI sometimes adds it)
  const cleaned = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error(
      'TENANT_ROUTING_MASTER_KEY must be hex-encoded (a 64-char hex string for ' +
      'a 32-byte key). Got non-hex characters.',
    );
  }
  const buf = Buffer.from(cleaned, 'hex');
  if (buf.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `TENANT_ROUTING_MASTER_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes ` +
      `(${KEY_LENGTH_BYTES * 2} hex chars). Got ${buf.length} bytes.`,
    );
  }
  return buf;
}

/**
 * Encrypt a secret (typically a Supabase service-role key) for storage in
 * tenant_routing. Each call generates a fresh IV, so the same plaintext
 * produces different ciphertext every time — never reuse IV with the same key.
 */
export function encryptSecret(plaintext: string): EncryptedSecret {
  if (!plaintext) {
    throw new Error('encryptSecret: plaintext is empty');
  }
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  if (tag.length !== AUTH_TAG_LENGTH_BYTES) {
    // Should never happen — node's GCM impl always returns 16-byte tag for default settings
    throw new Error(`Unexpected auth tag length: ${tag.length}`);
  }
  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt a secret previously encrypted with encryptSecret. Throws on:
 *   - Missing master key (env misconfig)
 *   - Wrong master key (auth tag mismatch — looks like tampering)
 *   - Tampered ciphertext, iv, or tag (auth tag mismatch)
 *   - Malformed hex inputs
 *
 * Callers should treat any thrown error as "this tenant cannot be reached"
 * and return a clear server error rather than retry with bogus credentials.
 */
export function decryptSecret(encrypted: EncryptedSecret): string {
  const { ciphertext, iv, tag } = encrypted;
  if (!ciphertext || !iv || !tag) {
    throw new Error('decryptSecret: missing ciphertext, iv, or tag');
  }
  const key = getMasterKey();
  let ivBuf: Buffer;
  let tagBuf: Buffer;
  let ctBuf: Buffer;
  try {
    ivBuf = Buffer.from(iv, 'hex');
    tagBuf = Buffer.from(tag, 'hex');
    ctBuf = Buffer.from(ciphertext, 'hex');
  } catch (e) {
    throw new Error(`decryptSecret: malformed hex input: ${(e as Error).message}`);
  }
  if (ivBuf.length !== IV_LENGTH_BYTES) {
    throw new Error(`decryptSecret: iv must be ${IV_LENGTH_BYTES} bytes, got ${ivBuf.length}`);
  }
  if (tagBuf.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error(`decryptSecret: tag must be ${AUTH_TAG_LENGTH_BYTES} bytes, got ${tagBuf.length}`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, ivBuf);
  decipher.setAuthTag(tagBuf);
  try {
    const plaintext = Buffer.concat([
      decipher.update(ctBuf),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch (e) {
    // GCM auth tag verification failure throws here. Don't leak details
    // (the same error covers "wrong key", "tampered ciphertext", and
    // "tampered tag" — all of which the caller should treat identically).
    throw new Error('decryptSecret: authentication failed (wrong key or tampered ciphertext)');
  }
}

/**
 * Check whether the master key is configured. Useful for startup health
 * checks in functions that touch tenant routing.
 */
export function hasMasterKey(): boolean {
  try {
    getMasterKey();
    return true;
  } catch {
    return false;
  }
}
