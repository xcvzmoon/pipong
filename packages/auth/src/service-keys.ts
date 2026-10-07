import type { TenantTransaction } from '@pipong/database/tenancy';
import type { ApiConfig } from '@pipong/shared';
import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth/minimal';
import { organization } from 'better-auth/plugins/organization';
import { v7 } from 'uuid';
import { createAuthAdapter } from './adapter.ts';

export type IssuedAuthKey = { id: string; key: string };
/**
 * Issues an organization-owned auth key inside the caller's transaction.
 *
 * @param transaction - Active transaction authorized for service-key:manage.
 * @param userId - Authorized owner or admin who requested issuance.
 * @param organizationId - Organization that owns the key.
 * @param name - Validated integration name.
 * @param expiresIn - Validated lifetime in seconds, from 60 to 31,536,000.
 * @returns Auth key ID and once-visible secret. Bind its grant and audit in the same transaction before returning the secret to a client.
 * @throws {Error} Better Auth or database failures propagate and must roll back the transaction.
 * @example
 * ```ts
 * const issued = await auth.issueServiceKey(transaction, actor.userId, scope.organizationId, 'Backend', 3600);
 * ```
 */
export type ServiceKeyIssuer = (
  transaction: TenantTransaction,
  userId: string,
  organizationId: string,
  name: string,
  expiresIn: number,
) => Promise<IssuedAuthKey>;

export function serviceKeyPlugin(): ReturnType<typeof apiKey> {
  return apiKey({
    references: 'organization',
    enableSessionForAPIKeys: false,
    defaultPrefix: 'pipong_',
    requireName: true,
    maximumNameLength: 100,
    startingCharactersConfig: { shouldStore: false },
    keyExpiration: { minExpiresIn: 1 / 1440, maxExpiresIn: 365 },
    rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 100 },
  });
}

export function createServiceKeyIssuer(config: ApiConfig): ServiceKeyIssuer {
  return async (transaction, userId, organizationId, name, expiresIn) => {
    const auth = betterAuth({
      baseURL: config.authBaseUrl,
      secret: config.authSecret,
      logger: { disabled: true },
      database: createAuthAdapter(transaction),
      advanced: { database: { generateId: () => v7() } },
      plugins: [
        organization({ allowUserToCreateOrganization: false, disableOrganizationDeletion: true }),
        serviceKeyPlugin(),
      ],
    });
    const { id, key } = await auth.api.createApiKey({
      body: { configId: 'default', userId, organizationId, name, expiresIn },
    });

    return { id, key };
  };
}
