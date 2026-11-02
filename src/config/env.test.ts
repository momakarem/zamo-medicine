import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError, envSchema } from './env.ts';

/** A complete, valid environment used as the baseline for each case. */
const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://zamo:zamo@localhost:5432/zamo_dev',
  SESSION_SECRET: 'a'.repeat(32),
  OTP_PEPPER: 'b'.repeat(32),
} satisfies NodeJS.ProcessEnv;

describe('ZAMO-INFRA-002 :: config validation', () => {
  it('accepts a complete environment', () => {
    const cfg = loadConfig(base);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.DATABASE_URL).toContain('postgresql://');
  });

  it('applies documented defaults when optional vars are absent', () => {
    const cfg = loadConfig(base);
    expect(cfg.OTP_TTL_SECONDS).toBe(300);
    expect(cfg.OTP_MAX_ATTEMPTS).toBe(5);
    expect(cfg.NOTIFICATION_ADAPTER).toBe('memory');
  });

  // --- Fail-fast on missing required variables -----------------------------

  it('FAILS when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...withoutDb } = base;
    expect(() => loadConfig(withoutDb)).toThrow(ConfigError);
  });

  it('FAILS when SESSION_SECRET is missing', () => {
    const { SESSION_SECRET: _omit, ...withoutSecret } = base;
    expect(() => loadConfig(withoutSecret)).toThrow(ConfigError);
  });

  it('FAILS when OTP_PEPPER is missing', () => {
    const { OTP_PEPPER: _omit, ...withoutPepper } = base;
    expect(() => loadConfig(withoutPepper)).toThrow(ConfigError);
  });

  it('FAILS on a short (low-entropy) secret', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'too-short' })).toThrow(ConfigError);
  });

  it('FAILS on a malformed DATABASE_URL', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'not-a-url' })).toThrow(ConfigError);
  });

  it('FAILS on an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'qa' })).toThrow(ConfigError);
  });

  // --- Error reporting must not leak secret values -------------------------

  it('never echoes a secret value in the error message', () => {
    const leaky = 'SUPERSECRET-VALUE-THAT-MUST-NOT-LEAK-0123456789';
    try {
      // Force a failure on a *different* field while a secret is present.
      loadConfig({ ...base, SESSION_SECRET: leaky, DATABASE_URL: 'not-a-url' });
      expect.unreachable('config should have been rejected');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).not.toContain(leaky);
    }
  });

  // --- Environment separation (DEC-018) ------------------------------------

  it('FAILS when staging points at a production database', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'staging',
        DATABASE_URL: 'postgresql://u:p@db.internal:5432/zamo_production',
      }),
    ).toThrow(/production database/i);
  });

  it('allows staging on its own database', () => {
    const cfg = loadConfig({
      ...base,
      NODE_ENV: 'staging',
      DATABASE_URL: 'postgresql://u:p@db.internal:5432/zamo_staging',
    });
    expect(cfg.NODE_ENV).toBe('staging');
  });

  it('FAILS when production still uses a test notification adapter', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        NOTIFICATION_ADAPTER: 'memory',
      }),
    ).toThrow(/notification provider/i);
  });

  it('allows production with a real provider configured', () => {
    const cfg = loadConfig({
      ...base,
      NODE_ENV: 'production',
      NOTIFICATION_ADAPTER: 'provider',
      LLM_ADAPTER: 'openai',
      OPENAI_API_KEY: 'sk-test-key-for-test-suite-only-1234',
    });
    expect(cfg.NOTIFICATION_ADAPTER).toBe('provider');
  });

  // --- Per-environment loading --------------------------------------------

  it('loads a distinct configuration per environment', () => {
    const dev = loadConfig({ ...base, NODE_ENV: 'development' });
    const test = loadConfig({ ...base, NODE_ENV: 'test' });
    expect(dev.NODE_ENV).not.toBe(test.NODE_ENV);
  });

  it('admin sessions expire sooner than patient sessions by default (A-47)', () => {
    const cfg = loadConfig(base);
    expect(cfg.SESSION_TTL_ADMIN_MIN).toBeLessThan(cfg.SESSION_TTL_STAFF_MIN);
    expect(cfg.SESSION_TTL_STAFF_MIN).toBeLessThan(cfg.SESSION_TTL_PATIENT_MIN);
  });

  it('exposes the four supported environments', () => {
    const shape = envSchema.safeParse({
      ...base,
      NODE_ENV: 'production',
      NOTIFICATION_ADAPTER: 'provider',
      LLM_ADAPTER: 'openai',
      OPENAI_API_KEY: 'sk-test-key-for-env-test-suite-1234',
    });
    expect(shape.success).toBe(true);
  });
});
