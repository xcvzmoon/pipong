import { booleanSchema } from '@pipong/shared';
import { defineEnv } from '@xcvzlabs/env';
import * as v from 'valibot';

const PG_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const SECURE_SSL_MODES = new Set(['require', 'verify-ca', 'verify-full']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const nodeEnv = defineEnv({
  schema: {
    node: {
      env: v.optional(v.picklist(['development', 'test', 'production']), 'development'),
    },
  },
});

const databaseUrlSchema = v.pipe(
  v.string('DATABASE_URL must be a string'),
  v.trim(),
  v.nonEmpty('DATABASE_URL is required'),
  v.maxLength(2048, 'DATABASE_URL is too long'),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) return;

    let url: URL | null = null;

    try {
      url = new URL(dataset.value);
    } catch {
      url = null;
    }

    if (!url) {
      addIssue({
        message:
          'DATABASE_URL is not a parseable URL (percent-encode special characters in the password)',
      });
      return;
    }

    if (!PG_PROTOCOLS.has(url.protocol)) {
      addIssue({ message: 'DATABASE_URL must use postgres:// or postgresql://' });
    }

    if (!url.hostname) {
      addIssue({ message: 'DATABASE_URL is missing a host' });
    }

    if (!url.username) {
      addIssue({ message: 'DATABASE_URL is missing a username' });
    }

    const dbName = url.pathname.replace(/^\//, '');

    if (!dbName || dbName.includes('/')) {
      addIssue({ message: 'DATABASE_URL must end with a single database name' });
    }

    if (nodeEnv.node.env === 'production') {
      if (LOCAL_HOSTS.has(url.hostname)) {
        addIssue({ message: 'DATABASE_URL must not point to localhost in production' });
      }

      const mode = url.searchParams.get('sslmode');

      if (!mode || !SECURE_SSL_MODES.has(mode)) {
        addIssue({
          message: 'DATABASE_URL must set sslmode=require, verify-ca or verify-full in production',
        });
      }
    }
  }),
);

const rest = defineEnv({
  schema: {
    database: {
      url: databaseUrlSchema,
    },
    flags: {
      useQueryLogger: v.optional(booleanSchema, 'false'),
    },
  },
});

export const env = { ...nodeEnv, ...rest };
