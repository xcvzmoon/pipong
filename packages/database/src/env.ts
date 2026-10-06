import { defineEnv } from '@xcvzlabs/env';
import * as v from 'valibot';
import {
  applicationNameSchema,
  databaseSettingsSchema,
  databaseUrlSchema,
  maxPoolSchema,
  nodeEnvSchema,
  validateProductionUrl,
} from './env-schema.ts';

/**
 * Internal API, worker, and migration settings, validated once at import.
 * URLs are optional here and required by the connection or tool that uses them.
 * Numeric and boolean values are parsed by the schemas;
 * this module creates no pools. Production URL policy is checked before import
 * completes. Applications consume the connection factories instead of this value.
 */
export const env = defineEnv({
  schema: {
    node: {
      env: nodeEnvSchema,
    },
    migration: {
      database: {
        url: v.optional(databaseUrlSchema),
      },
    },
    api: {
      database: {
        ...databaseSettingsSchema,
        url: v.optional(databaseUrlSchema),
        maxPool: v.optional(maxPoolSchema, '8'),
        applicationName: v.optional(applicationNameSchema, 'pipong_api'),
      },
    },
    worker: {
      database: {
        ...databaseSettingsSchema,
        url: v.optional(databaseUrlSchema),
        maxPool: v.optional(maxPoolSchema, '12'),
        applicationName: v.optional(applicationNameSchema, 'pipong_worker'),
      },
    },
  },
});

if (env.api.database.url !== undefined) {
  validateProductionUrl('API_DATABASE_URL', env.api.database.url, env.node.env);
}

if (env.worker.database.url !== undefined) {
  validateProductionUrl('WORKER_DATABASE_URL', env.worker.database.url, env.node.env);
}

if (env.migration.database.url !== undefined) {
  validateProductionUrl('MIGRATION_DATABASE_URL', env.migration.database.url, env.node.env);
}
