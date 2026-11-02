import { createHmac, randomBytes } from 'node:crypto';

/**
 * ZAMO-AUTH-008 — TOTP (Time-based One-Time Password) for MFA.
 *
 * Implements RFC 6238 using only node:crypto.
 *
 * Rules:
 *  - A-43: MFA is mandatory for zamo_admin users.
 *  - Facility managers can optionally enforce MFA for their staff.
 *  - TOTP period: 30 seconds. Digits: 6. Algorithm: SHA-1 (standard).
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TOTP_PERIOD = 30;     // seconds
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = 'sha1';

// ---------------------------------------------------------------------------
// Secret management
// ---------------------------------------------------------------------------

/**
 * Generate a new TOTP secret (20 bytes, base32-encoded).
 */
export function generateTotpSecret(): string {
  const raw = randomBytes(20);
  return base32Encode(raw);
}

/**
 * Build an otpauth:// URI for QR code generation.
 */
export function buildTotpUri(secret: string, user: string, issuer: string = 'Zamo'): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user)}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// TOTP generation & verification
// ---------------------------------------------------------------------------

/**
 * Generate a TOTP code for the given secret at the given time.
 */
export function generateTotp(secret: string, time: number = Date.now()): string {
  const counter = Math.floor(time / 1000 / TOTP_PERIOD);
  return hotpCode(base32Decode(secret), counter);
}

/**
 * Verify a TOTP code. Allows ±1 window drift to account for clock skew.
 */
export function verifyTotp(secret: string, code: string, time: number = Date.now()): boolean {
  const counter = Math.floor(time / 1000 / TOTP_PERIOD);
  // Check current window ±1
  for (let offset = -1; offset <= 1; offset++) {
    const expected = hotpCode(base32Decode(secret), counter + offset);
    if (constantTimeEqual(code, expected)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// HOTP core (RFC 4226)
// ---------------------------------------------------------------------------

function hotpCode(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // Write counter as big-endian 64-bit integer
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac(TOTP_ALGORITHM, secret).update(buf).digest();

  // Dynamic truncation
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(binCode % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

// ---------------------------------------------------------------------------
// Base32 (RFC 4648)
// ---------------------------------------------------------------------------

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_CHARS[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Constant-time string comparison
// ---------------------------------------------------------------------------

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// MFA enforcement logic
// ---------------------------------------------------------------------------

/** Roles that MUST have MFA enabled (A-43). */
const MFA_MANDATORY_ROLES = new Set(['zamo_admin']);

/**
 * Check if MFA is required for a given role.
 *
 * - zamo_admin: always required (A-43).
 * - Other facility roles: required if the facility manager has enforced it.
 */
export function isMfaRequired(roleCode: string, facilityEnforcesMfa: boolean = false): boolean {
  if (MFA_MANDATORY_ROLES.has(roleCode)) return true;
  return facilityEnforcesMfa;
}
