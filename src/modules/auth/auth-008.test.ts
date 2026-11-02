import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  DEFAULT_PASSWORD_POLICY,
} from './password.ts';
import {
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  buildTotpUri,
  base32Encode,
  base32Decode,
  isMfaRequired,
} from './mfa.ts';

// =========================================================================
// ZAMO-AUTH-008 :: Password
// =========================================================================

describe('ZAMO-AUTH-008 :: password hashing', () => {
  it('hashes and verifies a correct password', () => {
    const hash = hashPassword('MyStr0ng!Pass#1');
    expect(verifyPassword('MyStr0ng!Pass#1', hash)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const hash = hashPassword('MyStr0ng!Pass#1');
    expect(verifyPassword('WrongPassword!1', hash)).toBe(false);
  });

  it('produces different hashes for the same password (unique salt)', () => {
    const h1 = hashPassword('MyStr0ng!Pass#1');
    const h2 = hashPassword('MyStr0ng!Pass#1');
    expect(h1).not.toBe(h2);
  });

  it('hash format includes scrypt parameters', () => {
    const hash = hashPassword('MyStr0ng!Pass#1');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(hash.split(':').length).toBe(6);
  });

  it('rejects a malformed hash', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
  });

  it('passwords are NEVER stored as plain text (format check)', () => {
    const hash = hashPassword('MyStr0ng!Pass#1');
    expect(hash).not.toContain('MyStr0ng!Pass#1');
  });
});

describe('ZAMO-AUTH-008 :: password policy', () => {
  it('accepts a compliant password', () => {
    expect(validatePassword('MyStr0ng!Pass#1')).toEqual([]);
  });

  it('rejects too-short passwords', () => {
    const violations = validatePassword('Short!1a');
    expect(violations).toContain('TOO_SHORT');
  });

  it('requires uppercase', () => {
    const violations = validatePassword('mystrongpass!1ab');
    expect(violations).toContain('MISSING_UPPERCASE');
  });

  it('requires lowercase', () => {
    const violations = validatePassword('MYSTRONGPASS!1AB');
    expect(violations).toContain('MISSING_LOWERCASE');
  });

  it('requires a digit', () => {
    const violations = validatePassword('MyStrongPass!abc');
    expect(violations).toContain('MISSING_DIGIT');
  });

  it('requires a special character', () => {
    const violations = validatePassword('MyStrongPass1abc');
    expect(violations).toContain('MISSING_SPECIAL');
  });

  it('returns multiple violations', () => {
    const violations = validatePassword('short');
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });

  it('uses the default policy', () => {
    expect(DEFAULT_PASSWORD_POLICY.minLength).toBe(12);
    expect(DEFAULT_PASSWORD_POLICY.requireUppercase).toBe(true);
  });
});

// =========================================================================
// ZAMO-AUTH-008 :: MFA (TOTP)
// =========================================================================

describe('ZAMO-AUTH-008 :: TOTP', () => {
  it('generates a 32-char base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThanOrEqual(20);
    expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
  });

  it('generates a valid 6-digit code', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('verifies a correct code', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotp(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
  });

  it('rejects an incorrect code', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('allows ±1 window drift', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    // Generate code for the previous window
    const prevCode = generateTotp(secret, now - 30_000);
    expect(verifyTotp(secret, prevCode, now)).toBe(true);
  });

  it('builds a valid otpauth:// URI', () => {
    const secret = generateTotpSecret();
    const uri = buildTotpUri(secret, 'user@test.com');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(secret);
    expect(uri).toContain('Zamo');
  });
});

describe('ZAMO-AUTH-008 :: base32', () => {
  it('round-trips encode/decode', () => {
    const original = Buffer.from('Hello, ZAMO!');
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    expect(decoded.toString()).toBe('Hello, ZAMO!');
  });
});

describe('ZAMO-AUTH-008 :: MFA enforcement', () => {
  it('MFA is mandatory for zamo_admin (A-43)', () => {
    expect(isMfaRequired('zamo_admin')).toBe(true);
  });

  it('MFA is NOT required for regular staff by default', () => {
    expect(isMfaRequired('receptionist')).toBe(false);
    expect(isMfaRequired('doctor')).toBe(false);
  });

  it('MFA is required for staff when facility enforces it', () => {
    expect(isMfaRequired('receptionist', true)).toBe(true);
    expect(isMfaRequired('doctor', true)).toBe(true);
  });

  it('MFA is NOT required for patients', () => {
    expect(isMfaRequired('patient')).toBe(false);
    expect(isMfaRequired('patient', true)).toBe(true);
  });
});
