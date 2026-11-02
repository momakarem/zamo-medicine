import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseDotenv,
  deepFreeze,
  bootConfig,
  _resetConfigForTest,
} from './env-loader.ts';

/** Create a temp directory pre-populated with environment files. */
function makeTmpRoot(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'zamo-infra002-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}

const VALID_SECRETS = {
  SESSION_SECRET: 'a'.repeat(32),
  OTP_PEPPER: 'b'.repeat(32),
};

const BASE_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://zamo:zamo@localhost:5432/zamo_dev',
  ...VALID_SECRETS,
};

/** Write a standard .env that passes validation. */
function writeBaseEnv(dir: string, overrides: Record<string, string> = {}): void {
  const merged = { ...BASE_ENV, ...overrides };
  const content = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync(join(dir, '.env'), content, 'utf8');
}

describe('ZAMO-INFRA-002 :: env-loader', () => {
  let tmpRoot: string;

  beforeEach(() => {
    _resetConfigForTest();
  });

  afterEach(() => {
    _resetConfigForTest();
    if (tmpRoot) {
      try {
        rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        // noop
      }
    }
  });

  // --- parseDotenv ----------------------------------------------------------

  it('parses KEY=VALUE lines', () => {
    const result = parseDotenv('FOO=bar\nBAZ=qux');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('strips surrounding quotes', () => {
    const result = parseDotenv(`A="hello"\nB='world'`);
    expect(result).toEqual({ A: 'hello', B: 'world' });
  });

  it('ignores comments and blank lines', () => {
    const result = parseDotenv('# comment\n\nKEY=val');
    expect(result).toEqual({ KEY: 'val' });
  });

  // --- deepFreeze -----------------------------------------------------------

  it('prevents mutation of the config object', () => {
    const obj = { a: 1, nested: { b: 2 } };
    const frozen = deepFreeze(obj);
    expect(() => {
      (frozen as Record<string, unknown>).a = 99;
    }).toThrow();
    expect(() => {
      (frozen.nested as Record<string, unknown>).b = 99;
    }).toThrow();
  });

  // --- bootConfig -----------------------------------------------------------

  it('loads config from .env file', () => {
    tmpRoot = makeTmpRoot();
    writeBaseEnv(tmpRoot);

    // Temporarily override process.env so only file values are used.
    const saved = { ...process.env };
    // Remove keys that would conflict
    for (const key of Object.keys(BASE_ENV)) {
      delete process.env[key];
    }
    try {
      const cfg = bootConfig(tmpRoot);
      expect(cfg.NODE_ENV).toBe('development');
      expect(cfg.DATABASE_URL).toContain('postgresql://');
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it('returns frozen config object', () => {
    tmpRoot = makeTmpRoot();
    writeBaseEnv(tmpRoot);

    const saved = { ...process.env };
    for (const key of Object.keys(BASE_ENV)) {
      delete process.env[key];
    }
    try {
      const cfg = bootConfig(tmpRoot);
      expect(Object.isFrozen(cfg)).toBe(true);
      expect(() => {
        (cfg as Record<string, unknown>).NODE_ENV = 'hacked';
      }).toThrow();
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it('returns the same singleton on second call', () => {
    tmpRoot = makeTmpRoot();
    writeBaseEnv(tmpRoot);

    const saved = { ...process.env };
    for (const key of Object.keys(BASE_ENV)) {
      delete process.env[key];
    }
    try {
      const first = bootConfig(tmpRoot);
      const second = bootConfig(tmpRoot);
      expect(first).toBe(second);
    } finally {
      Object.assign(process.env, saved);
    }
  });

  // --- .env.production guard ------------------------------------------------

  it('FAILS if .env.production exists in the project root', () => {
    tmpRoot = makeTmpRoot({
      '.env.production': 'SESSION_SECRET=real-prod-secret-should-never-be-here!!!!',
    });
    writeBaseEnv(tmpRoot);

    expect(() => bootConfig(tmpRoot)).toThrow(/\.env\.production/);
  });

  it('does NOT fail for .env.development or .env.staging', () => {
    tmpRoot = makeTmpRoot({
      '.env.development': `OTP_TTL_SECONDS=600`,
      '.env.staging': `OTP_TTL_SECONDS=300`,
    });
    writeBaseEnv(tmpRoot);

    const saved = { ...process.env };
    for (const key of Object.keys(BASE_ENV)) {
      delete process.env[key];
    }
    try {
      // Should not throw
      const cfg = bootConfig(tmpRoot);
      expect(cfg).toBeDefined();
    } finally {
      Object.assign(process.env, saved);
    }
  });

  // --- Environment-specific overrides ---------------------------------------

  it('overrides from .env.{NODE_ENV} take precedence over .env', () => {
    tmpRoot = makeTmpRoot({
      '.env.development': 'OTP_TTL_SECONDS=999',
    });
    writeBaseEnv(tmpRoot);

    const saved = { ...process.env };
    for (const key of Object.keys(BASE_ENV)) {
      delete process.env[key];
    }
    try {
      const cfg = bootConfig(tmpRoot);
      expect(cfg.OTP_TTL_SECONDS).toBe(999);
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it('process.env wins over file values (twelve-factor)', () => {
    tmpRoot = makeTmpRoot();
    writeBaseEnv(tmpRoot, { OTP_TTL_SECONDS: '123' });

    const saved = process.env['OTP_TTL_SECONDS'];
    process.env['OTP_TTL_SECONDS'] = '777';
    // Ensure minimum required vars exist in process.env
    const savedRequired = {} as Record<string, string | undefined>;
    for (const [key, val] of Object.entries(BASE_ENV)) {
      savedRequired[key] = process.env[key];
      process.env[key] = val;
    }
    process.env['OTP_TTL_SECONDS'] = '777';
    try {
      const cfg = bootConfig(tmpRoot);
      expect(cfg.OTP_TTL_SECONDS).toBe(777);
    } finally {
      for (const [key, val] of Object.entries(savedRequired)) {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
      if (saved === undefined) delete process.env['OTP_TTL_SECONDS'];
      else process.env['OTP_TTL_SECONDS'] = saved;
    }
  });
});
