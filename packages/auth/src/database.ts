import type { DatabaseRuntime } from '@pipong/database';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { authRelations } from './relations.ts';
import * as schema from './schema.ts';

export type AuthClient = ReturnType<typeof createAuthClient>;
export type AuthTransaction = Parameters<Parameters<AuthClient['transaction']>[0]>[0];

export function createAuthAdapter(
  client: AuthClient | AuthTransaction,
): ReturnType<typeof drizzleAdapter> {
  return drizzleAdapter(client, {
    provider: 'pg',
    transaction: true,
    schemaName: 'auth',
    schema,
  });
}

export function createAuthClient(database: DatabaseRuntime): NodePgDatabase<typeof authRelations> {
  return drizzle({ client: database.pool, relations: authRelations });
}
