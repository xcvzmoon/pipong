import type { AuthClient, AuthTransaction } from '@pipong/database/auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { authTables } from '@pipong/database/auth';

export function createAuthAdapter(
  client: AuthClient | AuthTransaction,
): ReturnType<typeof drizzleAdapter> {
  return drizzleAdapter(client, {
    provider: 'pg',
    usePlural: true,
    transaction: true,
    schemaName: 'auth',
    schema: authTables,
  });
}
