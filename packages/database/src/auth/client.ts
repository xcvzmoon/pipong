import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseRuntime } from '../clients.ts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { authRelations } from './relations.ts';

export type AuthClient = NodePgDatabase<typeof authRelations>;
export type AuthTransaction = Parameters<Parameters<AuthClient['transaction']>[0]>[0];

export function createAuthClient(database: DatabaseRuntime): AuthClient {
  return drizzle({ client: database.pool, relations: authRelations });
}

/** Creates a disconnected client for Better Auth's schema generator. */
export function createAuthSchemaClient(): AuthClient {
  return drizzle({ client: new Pool(), relations: authRelations });
}
