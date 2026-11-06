import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  DEMO_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  DEMO_ORG_SLUG: z.string().default('demo'),
  // Demo limits (BR-015): scenarios per rolling hour and the pause between dataset resets.
  DEMO_SCENARIOS_PER_HOUR: z.coerce.number().int().min(1).default(6),
  DEMO_RESET_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),
  // How often the simulator appends the minutes that have completed since the last tick.
  SIMULATOR_TICK_MS: z.coerce.number().int().min(1000).default(10_000),
  // Timers (alert evaluation, outbox publishing). Tests switch them off and drive them directly.
  BACKGROUND_WORKERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  ALERT_EVAL_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(500),
});

export type Env = z.infer<typeof envSchema>;

/** Loads the root .env (when present) and validates the process environment. */
export function loadEnv(): Env {
  try {
    process.loadEnvFile(new URL('../../../../.env', import.meta.url));
  } catch {
    // No .env file: rely on the real environment.
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${JSON.stringify(z.treeifyError(parsed.error))}`);
  }
  return parsed.data;
}
