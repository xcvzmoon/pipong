import type { TenantScope, TenantTransaction } from '../tenancy/index.ts';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { recipients } from './schema.ts';

export type EnvironmentScope = Extract<TenantScope, { kind: 'environment' }>;
export type RecipientRecord = typeof recipients.$inferSelect;

/**
 * Inserts a recipient or refreshes an existing active identity atomically.
 * @param transaction - Authorized tenant transaction.
 * @param scope - Environment that owns the recipient.
 * @param externalId - Validated, case-sensitive application identity.
 * @returns The active record, or undefined if the identity has been deleted.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const record = await upsertRecipient(transaction, scope, 'customer-42')
 * console.info(record?.id)
 * ```
 */
export async function upsertRecipient(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  externalId: string,
): Promise<RecipientRecord | undefined> {
  const [record] = await transaction
    .insert(recipients)
    .values({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      externalId,
    })
    .onConflictDoUpdate({
      target: [
        recipients.organizationId,
        recipients.projectId,
        recipients.environmentId,
        recipients.externalId,
      ],
      set: { updatedAt: sql`now()` },
      setWhere: isNull(recipients.deletedAt),
    })
    .returning();
  return record;
}

/**
 * Lists active recipients in ascending ID order.
 * @param transaction - Authorized tenant transaction.
 * @param scope - Owning environment.
 * @param limit - Maximum records to fetch.
 * @param afterId - Exclusive ID boundary, or undefined for the first page.
 * @returns Records within the supplied scope.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const records = await listRecipients(transaction, scope, 51, undefined)
 * console.info(records.length)
 * ```
 */
export function listRecipients(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  limit: number,
  afterId: string | undefined,
): Promise<RecipientRecord[]> {
  return transaction
    .select()
    .from(recipients)
    .where(
      and(
        recipientScope(scope),
        isNull(recipients.deletedAt),
        afterId ? gt(recipients.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(recipients.id))
    .limit(limit);
}

/**
 * Reads an active recipient within its environment.
 * @param transaction - Authorized tenant transaction.
 * @param scope - Owning environment.
 * @param id - Recipient UUID.
 * @returns The record, or undefined for a missing, deleted, or out-of-scope ID.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const record = await readRecipient(transaction, scope, id)
 * console.info(record?.externalId)
 * ```
 */
export async function readRecipient(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  id: string,
): Promise<RecipientRecord | undefined> {
  const [record] = await transaction
    .select()
    .from(recipients)
    .where(and(recipientScope(scope), eq(recipients.id, id), isNull(recipients.deletedAt)));
  return record;
}

/**
 * Marks one active recipient deleted without removing its identity reservation.
 * @param transaction - Authorized tenant transaction.
 * @param scope - Owning environment.
 * @param id - Recipient UUID.
 * @returns The deleted record, or undefined if it was already absent.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const record = await deleteRecipient(transaction, scope, id)
 * console.info(record?.deletedAt)
 * ```
 */
export async function deleteRecipient(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  id: string,
): Promise<RecipientRecord | undefined> {
  const [record] = await transaction
    .update(recipients)
    .set({ deletedAt: sql`now()` })
    .where(and(recipientScope(scope), eq(recipients.id, id), isNull(recipients.deletedAt)))
    .returning();
  return record;
}

function recipientScope(scope: EnvironmentScope): ReturnType<typeof and> {
  return and(
    eq(recipients.organizationId, scope.organizationId),
    eq(recipients.projectId, scope.projectId),
    eq(recipients.environmentId, scope.environmentId),
  );
}
