import type { BetterAuthOptions } from 'better-auth';
import { apiKey } from '@better-auth/api-key';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { authTables, createAuthSchemaClient } from '@pipong/database/auth';
import { betterAuth } from 'better-auth/minimal';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';

const options: BetterAuthOptions = {
  baseURL: 'http://localhost:3000',
  secret: 'schema-generation-only-not-used-at-runtime',
  database: drizzleAdapter(createAuthSchemaClient(), {
    provider: 'pg',
    transaction: true,
    schemaName: 'auth',
    schema: authTables,
  }),
  rateLimit: {
    storage: 'database',
  },
  plugins: [
    organization(),
    twoFactor(),
    apiKey({
      references: 'organization',
    }),
  ],
};

export const auth = betterAuth(options);
