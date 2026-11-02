import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, type AppConfig } from './env.ts';

/**
 * ZAMO-INFRA-002 — environment loader.
 *
 * Responsibilities:
 *  1. Parse a `.env` file matching the current NODE_ENV (if present).
 *  2. Merge file values with `process.env` (process.env wins — twelve-factor).
 *  3. Feed the merged bag into the validated `loadConfig()`.
 *  4. Return a **deeply frozen** config: no mutation after boot.
 *  5. Guard: refuse to boot if `.env.production` exists in the project tree.
 */

const PROJECT_ROOT = join(import.meta.dirname ?? '.', '..', '..');

/**
 * Minimal .env parser — handles KEY=VALUE, KEY="VALUE", KEY='VALUE',
 * empty lines and `#` comments. No interpolation.
 */
export function parseDotenv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Read a `.env` file if it exists. Returns an empty object otherwise.
 */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseDotenv(readFileSync(path, 'utf8'));
}

/**
 * Guard: `.env.production` must NEVER exist in the project tree. Production
 * secrets are managed externally (Vault, CI secrets, cloud env vars). A
 * committed or locally-present `.env.production` is a security incident
 * waiting to happen.
 */
function guardNoProductionEnvFile(root: string): void {
  const forbidden = join(root, '.env.production');
  if (existsSync(forbidden)) {
    throw new Error(
      'SECURITY: .env.production file detected. ' +
        'Production secrets must be managed externally (CI secrets, Vault, or cloud env vars). ' +
        'Remove .env.production immediately and rotate any secrets it contained.',
    );
  }
}

/**
 * Deep-freeze an object and all nested objects so config cannot be mutated
 * after boot. This is a defence-in-depth measure: accidental mutation of
 * config (e.g. `cfg.SESSION_SECRET = ''`) would be a silent security bug.
 */
export function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

/** Singleton. `null` until the first call to `bootConfig()`. */
let _config: Readonly<AppConfig> | null = null;

/**
 * Boot the application configuration. Call once at startup.
 *
 * Load order (last wins):
 *  1. `.env`            — shared defaults
 *  2. `.env.{NODE_ENV}` — environment-specific overrides
 *  3. `process.env`     — explicit overrides (twelve-factor)
 */
export function bootConfig(root: string = PROJECT_ROOT): Readonly<AppConfig> {
  if (_config !== null) return _config;

  guardNoProductionEnvFile(root);

  const base = readEnvFile(join(root, '.env'));
  const env = process.env['NODE_ENV'] ?? base['NODE_ENV'] ?? 'development';
  const envSpecific = env !== 'production' ? readEnvFile(join(root, `.env.${env}`)) : {};

  // Merge: file values < env-specific < process.env.
  const merged: Record<string, string | undefined> = {
    ...base,
    ...envSpecific,
    ...process.env,
  };

  const cfg = loadConfig(merged);
  _config = deepFreeze(cfg);
  return _config;
}

/**
 * Return the booted config. Throws if `bootConfig()` was never called.
 * Use in application code that runs after startup.
 */
export function getConfig(): Readonly<AppConfig> {
  if (_config === null) {
    throw new Error('getConfig() called before bootConfig(). Call bootConfig() at startup.');
  }
  return _config;
}

/** Reset the singleton — test use only. */
export function _resetConfigForTest(): void {
  _config = null;
}
