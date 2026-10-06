import type { BetterAuthOptions } from 'better-auth';
import { apiKey } from '@better-auth/api-key';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { betterAuth } from 'better-auth/minimal';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/schema.ts';

const options: BetterAuthOptions = {
  baseURL: 'http://localhost:3000',
  secret: 'schema-generation-only-not-used-at-runtime',
  database: drizzleAdapter(drizzle({ client: new Pool() }), {
    provider: 'pg',
    transaction: true,
    schemaName: 'auth',
    schema,
  }),
  rateLimit: { storage: 'database' },
  plugins: [organization(), twoFactor(), apiKey({ references: 'organization' })],
};

export const auth = betterAuth(options);
