import type { AuthClient, AuthTransaction } from '@pipong/database/auth';
import type { TenantTransaction } from '@pipong/database/tenancy';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { authTables } from '@pipong/database/auth';

/** Creates the auth adapter with service-key deletion reserved for the erasure lifecycle. */
export function createAuthAdapter(
  client: AuthClient | AuthTransaction | TenantTransaction,
): ReturnType<typeof drizzleAdapter> {
  const createAdapter = drizzleAdapter(client, {
    provider: 'pg',
    usePlural: true,
    transaction: true,
    schemaName: 'auth',
    schema: authTables,
  });

  return (options) => {
    const adapter = createAdapter(options);

    return {
      ...adapter,
      delete: async (input) => {
        if (input.model === 'apikey') {
          return;
        }

        await adapter.delete(input);
      },
      deleteMany: (input) => {
        if (input.model === 'apikey') {
          return Promise.resolve(0);
        }

        return adapter.deleteMany(input);
      },
    };
  };
}
