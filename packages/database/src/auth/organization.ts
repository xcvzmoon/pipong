import type { AuthClient, AuthTransaction } from './client.ts';
import { and, eq, isNull } from 'drizzle-orm';
import { invitations, organizations } from './schema.ts';

/**
 * Serializes a native organization request with suspension and erasure.
 * Resolve an invitation before locking its organization; missing or disabled
 * organizations fail closed. The callback must use the supplied transaction.
 * @param client - Authentication database client.
 * @param organizationId - Explicit organization ID, or null for an invitation operation.
 * @param invitationId - Invitation ID, or null for an organization operation.
 * @param run - Auth handler using this transaction for all writes and queued email.
 * @returns Callback response, or null when the organization is unavailable.
 * @throws {Error} Database and callback failures roll back all writes.
 * @example
 * ```ts
 * const response = await withActiveOrganization(client, organizationId, null, handle);
 * ```
 */
export function withActiveOrganization<Result>(
  client: AuthClient,
  organizationId: string | null,
  invitationId: string | null,
  run: (transaction: AuthTransaction) => Promise<Result>,
): Promise<Result | null> {
  return client.transaction(async (transaction) => {
    let id = organizationId;
    if (id === null && invitationId !== null) {
      const [invitation] = await transaction
        .select({ organizationId: invitations.organizationId })
        .from(invitations)
        .where(eq(invitations.id, invitationId));
      id = invitation?.organizationId ?? null;
    }
    if (id === null) {
      return null;
    }
    const [organization] = await transaction
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          eq(organizations.id, id),
          isNull(organizations.disabledAt),
          isNull(organizations.deletedAt),
        ),
      )
      .for('share');
    return organization ? run(transaction) : null;
  });
}
