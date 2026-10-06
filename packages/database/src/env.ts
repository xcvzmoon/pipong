import type { EnvironmentSource } from '@pipong/shared';
import { defineEnv } from '@xcvzlabs/env';
import * as v from 'valibot';

const databaseUrlSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(),
  v.maxLength(2048),
  v.url(),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    const url = new URL(dataset.value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.pathname.slice(1) ||
      url.pathname.slice(1).includes('/')
    )
      addIssue({ message: 'must be a PostgreSQL connection URL' });
  }),
);

export function parseDatabaseUrl(
  source: EnvironmentSource,
  variable: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL',
): string {
  try {
    const values = defineEnv({
      source,
      schema: {
        NODE_ENV: v.optional(v.picklist(['development', 'test', 'production']), 'development'),
        [variable]: databaseUrlSchema,
      },
    });
    const value = values[variable];
    if (value === undefined) throw new Error('missing URL');
    if (values.NODE_ENV === 'production') {
      const url = new URL(value);
      if (
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')
      ) {
        throw new Error('production database requires remote TLS');
      }
    }
    return value;
  } catch {
    throw new Error(`DATABASE_CONFIG_INVALID: invalid ${variable}`);
  }
}
