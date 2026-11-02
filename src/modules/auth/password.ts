import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * ZAMO-AUTH-008 — password hashing and policy.
 *
 * Facility staff (managers, receptionists, doctors, accountants) authenticate
 * with phone/email + password + MFA (A-43). Patients do NOT have passwords
 * (A-33 — they use OTP only).
 *
 * Uses scrypt (built into node:crypto) — a memory-hard KDF that resists
 * brute-force attacks. No external dependency required.
 */

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface PasswordPolicy {
  /** Minimum length (chars). Default: 12. */
  minLength: number;
  /** Require at least one uppercase letter. */
  requireUppercase: boolean;
  /** Require at least one lowercase letter. */
  requireLowercase: boolean;
  /** Require at least one digit. */
  requireDigit: boolean;
  /** Require at least one special character. */
  requireSpecial: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecial: true,
};

export type PasswordPolicyViolation =
  | 'TOO_SHORT'
  | 'MISSING_UPPERCASE'
  | 'MISSING_LOWERCASE'
  | 'MISSING_DIGIT'
  | 'MISSING_SPECIAL';

/**
 * Validate a password against the policy. Returns an array of violations
 * (empty if the password is acceptable).
 */
export function validatePassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = [];

  if (password.length < policy.minLength) violations.push('TOO_SHORT');
  if (policy.requireUppercase && !/[A-Z]/.test(password)) violations.push('MISSING_UPPERCASE');
  if (policy.requireLowercase && !/[a-z]/.test(password)) violations.push('MISSING_LOWERCASE');
  if (policy.requireDigit && !/\d/.test(password)) violations.push('MISSING_DIGIT');
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) violations.push('MISSING_SPECIAL');

  return violations;
}

// ---------------------------------------------------------------------------
// Hashing (scrypt)
// ---------------------------------------------------------------------------

const SALT_LENGTH = 32;
const KEY_LENGTH = 64;
const SCRYPT_COST = 16384;   // N
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLELISM = 1; // p

/**
 * Hash a password. Returns a string in the format:
 *   `scrypt:N:r:p:salt:hash`
 * where salt and hash are hex-encoded.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(password, salt, KEY_LENGTH, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELISM,
  });
  return `scrypt:${SCRYPT_COST}:${SCRYPT_BLOCK_SIZE}:${SCRYPT_PARALLELISM}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Verify a password against a stored hash.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const cost = parseInt(parts[1]!, 10);
  const blockSize = parseInt(parts[2]!, 10);
  const parallelization = parseInt(parts[3]!, 10);
  const salt = Buffer.from(parts[4]!, 'hex');
  const expected = Buffer.from(parts[5]!, 'hex');

  const derived = scryptSync(password, salt, expected.length, {
    cost,
    blockSize,
    parallelization,
  });

  return timingSafeEqual(derived, expected);
}
