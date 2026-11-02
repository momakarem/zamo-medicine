import { z } from 'zod';

/**
 * ZAMO-INFRA-002 — environment configuration.
 *
 * Acceptance criteria implemented here:
 *  - the process refuses to boot when a required variable is missing
 *    (fail fast, never fall back to a silent default for a secret);
 *  - Staging must never point at a production database (A-46 / DEC-018);
 *  - secret values are never echoed back in error messages.
 */

export const ENVIRONMENTS = ['development', 'staging', 'production', 'test'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Minimum entropy we accept for anything used to sign or encrypt. */
const MIN_SECRET_LENGTH = 32;

const secret = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .min(MIN_SECRET_LENGTH, `${label} must be at least ${MIN_SECRET_LENGTH} characters`);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(ENVIRONMENTS).default('development'),

    // --- Database (DEC-003: PostgreSQL) ---
    DATABASE_URL: z
      .string({ required_error: 'DATABASE_URL is required' })
      .url('DATABASE_URL must be a valid connection URL'),

    // --- Security (A-43, A-44, A-47) ---
    SESSION_SECRET: secret('SESSION_SECRET'),
    OTP_PEPPER: secret('OTP_PEPPER'),

    // --- Session lifetimes, in minutes (A-47) ---
    SESSION_TTL_PATIENT_MIN: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 24 * 7),
    SESSION_TTL_STAFF_MIN: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 8),
    SESSION_TTL_ADMIN_MIN: z.coerce.number().int().positive().default(30),

    // --- OTP policy (A-33) ---
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_REQUEST_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
    OTP_MAX_REQUESTS_PER_WINDOW: z.coerce.number().int().positive().default(5),

    // --- Outbound channels (DEC-009: providers are NOT decided yet, OQ-032) ---
    // 'console' and 'memory' are development/test adapters only.
    NOTIFICATION_ADAPTER: z.enum(['memory', 'console', 'provider']).default('memory'),

    // --- LLM provider (B-09: OpenAI is initial provider, LlmPort is abstract) ---
    // 'mock' is the test adapter. 'openai' requires OPENAI_API_KEY.
    LLM_ADAPTER: z.enum(['mock', 'openai']).default('mock'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL_DEFAULT: z.string().default('gpt-4o-mini'),
    OPENAI_MODEL_COMPLEX: z.string().default('gpt-4o'),
    OPENAI_MONTHLY_CAP_USD: z.coerce.number().positive().default(500),

    APP_BASE_URL: z.string().url().default('http://localhost:3000'),

    // --- Server ---
    PORT: z.coerce.number().int().positive().default(3000),

    // --- Feature flags ---
    // Allow starting without external providers (useful during initial deployment)
    ALLOW_MOCK_PROVIDERS: z.enum(['true', 'false']).default('false'),

    // --- Auto-migration on startup ---
    AUTO_MIGRATE: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((cfg, ctx) => {
    // Guard: staging and production must not share a database.
    // DEC-018 — Staging carries no real patient data.
    if (cfg.NODE_ENV === 'staging' && /(^|[^a-z])prod(uction)?([^a-z]|$)/i.test(cfg.DATABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'Staging must not point at a production database (DEC-018)',
      });
    }

    // Guard: a real provider is required once we are live; the in-memory
    // adapter would silently swallow every patient notification.
    if (cfg.NODE_ENV === 'production' && cfg.NOTIFICATION_ADAPTER !== 'provider' && cfg.ALLOW_MOCK_PROVIDERS !== 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NOTIFICATION_ADAPTER'],
        message: 'Production requires a real notification provider, not a test adapter. Set ALLOW_MOCK_PROVIDERS=true to override during initial deployment.',
      });
    }

    // Guard: OpenAI API key is required when using the OpenAI adapter (B-09).
    if (cfg.LLM_ADAPTER === 'openai' && !cfg.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when LLM_ADAPTER is "openai"',
      });
    }

    // Guard: production must not use mock LLM adapter.
    if (cfg.NODE_ENV === 'production' && cfg.LLM_ADAPTER === 'mock' && cfg.ALLOW_MOCK_PROVIDERS !== 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LLM_ADAPTER'],
        message: 'Production requires a real LLM provider, not the mock adapter. Set ALLOW_MOCK_PROVIDERS=true to override during initial deployment.',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  // Explicit field rather than a TS parameter property: Node's type-stripping
  // loader (used by the integration test runner) does not support those.
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Validate a raw environment bag. Never logs values — only variable names and
 * the reason they were rejected, so secrets cannot leak into logs or CI output.
 */
export function loadConfig(raw: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const key = i.path.join('.') || '(root)';
      return `${key}: ${i.message}`;
    });
    throw new ConfigError(issues);
  }
  return parsed.data;
}

export const isProduction = (c: AppConfig): boolean => c.NODE_ENV === 'production';
export const isTest = (c: AppConfig): boolean => c.NODE_ENV === 'test';
