// Pure-Node TOTP implementation (RFC 6238 / RFC 4226).
// No third-party deps — uses only Node's built-in `crypto` module.
//
// TOTP = HOTP(secret, floor(now / 30))
// HOTP = HMAC-SHA1 of the 8-byte big-endian counter, truncated to 6 digits.

import { createHmac, randomBytes } from 'node:crypto';

// RFC 4648 §6 base32 alphabet (uppercase, no padding variant here).
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += B32[(value << (5 - bits)) & 31];
  return result;
}

export function base32Decode(str: string): Buffer {
  const cleaned = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of cleaned) {
    const idx = B32.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 char: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a new 20-byte (160-bit) TOTP secret, returned as base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * Build the `otpauth://totp/...` URI for QR code generation.
 * The client renders this as a QR code; the user scans it in their
 * authenticator app (Google Authenticator, Authenticator Pro, etc.).
 */
export function buildOtpauthUri(secret: string, email: string, issuer = 'EQ Solutions'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(key: Buffer, counter: bigint): string {
  const msg = Buffer.alloc(8);
  // BigInt → 8-byte big-endian
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const hash = createHmac('sha1', key).update(msg).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    (((hash[offset] & 0x7f) << 24) |
     ((hash[offset + 1] & 0xff) << 16) |
     ((hash[offset + 2] & 0xff) << 8) |
     (hash[offset + 3] & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, '0');
}

/**
 * Verify a 6-digit TOTP code against a base32 secret.
 *
 * `driftWindows` allows ±N × 30s of clock drift between the server
 * and the user's authenticator. 1 is standard (covers 90s of drift).
 */
export function verifyTotp(secret: string, code: string, driftWindows = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  const t = BigInt(Math.floor(Date.now() / 1000 / 30));
  for (let d = -driftWindows; d <= driftWindows; d++) {
    if (hotp(key, t + BigInt(d)) === code) return true;
  }
  return false;
}
