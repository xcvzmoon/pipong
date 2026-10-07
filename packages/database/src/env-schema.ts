import { booleanSchema } from '@pipong/shared';
import * as v from 'valibot';

/** Accepted execution environments; defaults to development when unset. */
export const nodeEnvSchema = v.optional(
  v.picklist(['development', 'test', 'production']),
  'development',
);

/** PostgreSQL URL with a host, username, and one database path segment, up to 2048 characters. */
export const databaseUrlSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(),
  v.maxLength(2048),
  v.url(),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) {
      return;
    }

    const url = new URL(dataset.value);

    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.pathname.slice(1) ||
      url.pathname.slice(1).includes('/')
    ) {
      addIssue({ message: 'must be a PostgreSQL connection URL' });
    }
  }),
);

/** Parses an environment string into a per-process pool limit between 1 and 100. */
export const maxPoolSchema = v.pipe(
  v.string(),
  v.trim(),
  v.toNumber(),
  v.integer(),
  v.minValue(1),
  v.maxValue(100),
);

/** Parses a nonnegative integer timeout in milliseconds, up to 2147483647. */
export const timeoutSchema = v.pipe(
  v.string(),
  v.trim(),
  v.toNumber(),
  v.integer(),
  v.minValue(0),
  v.maxValue(2_147_483_647),
);

/** Trims a nonempty connection label of at most 63 characters. */
export const applicationNameSchema = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(63));

/** Shared URL, timeout, and query logging validators; role-specific budgets live in env.ts. */
export const databaseSettingsSchema = {
  url: databaseUrlSchema,
  connectionTimeout: v.optional(v.pipe(timeoutSchema, v.minValue(1)), '5000'),
  idleTimeout: v.optional(timeoutSchema, '30000'),
  useQueryLogger: v.optional(booleanSchema, 'false'),
};

/**
 * Applies production restrictions to an already validated PostgreSQL URL.
 * Development and test environments bypass this additional check.
 *
 * @example
 * ```ts
 * validateProductionUrl(
 *   'API_DATABASE_URL',
 *   'postgresql://pipong_api:password@db.example.com/pipong?sslmode=verify-full',
 *   'production',
 * );
 * ```
 *
 * @param variable Environment variable name included in the redacted error.
 * @param value URL already accepted by databaseUrlSchema.
 * @param nodeEnv Validated execution environment.
 * @throws An error containing DATABASE_CONFIG_INVALID for a production URL using
 * localhost, 127.0.0.1, or ::1, or lacking an accepted sslmode. This check does not
 * test connectivity or prove that a server certificate is trusted.
 */
export function validateProductionUrl(
  variable: string,
  value: string,
  nodeEnv: v.InferOutput<typeof nodeEnvSchema>,
): void {
  if (nodeEnv !== 'production') {
    return;
  }

  const { hostname, searchParams } = new URL(value);

  if (
    ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ||
    !['require', 'verify-ca', 'verify-full'].includes(searchParams.get('sslmode') ?? '')
  ) {
    throw new Error(`DATABASE_CONFIG_INVALID: invalid ${variable}`);
  }
}
