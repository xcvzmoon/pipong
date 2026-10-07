import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseRuntime } from '../clients.ts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { authRelations } from './relations.ts';

export type AuthClient = NodePgDatabase<typeof authRelations>;
export type AuthTransaction = Parameters<Parameters<AuthClient['transaction']>[0]>[0];

/**
 * Creates a relational authentication client using the runtime's existing pool.
 *
 * @param database - API runtime permitted to access authentication tables.
 * @returns Drizzle client configured with authentication relations; pool ownership stays with the runtime.
 *
 * @example
 * ```ts
 * const client = createAuthClient(database);
 * ```
 */
export function createAuthClient(database: DatabaseRuntime): AuthClient {
  return drizzle({ client: database.pool, relations: authRelations });
}

/**
 * Creates a disconnected authentication client for schema generation.
 *
 * @returns Client configured with auth relations. Do not use it for runtime database queries.
 *
 * @example
 * ```ts
 * const client = createAuthSchemaClient();
 * ```
 */
export function createAuthSchemaClient(): AuthClient {
  return drizzle({ client: new Pool(), relations: authRelations });
}
