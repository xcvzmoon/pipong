import type { TenantTransaction } from './tenancy/index.ts';
import { privilegedAudits } from './audit-schema.ts';

export type AuditEvent = typeof privilegedAudits.$inferInsert;

/**
 * Appends an authorized privileged operation in its application transaction.
 * A returned domain failure is still an audited attempt. Thrown failures roll back
 * both the operation and this record. Secrets and request bodies are never accepted.
 * @param transaction - Authorized API transaction with tenant context.
 * @param event - Human actor, required permission, and targeted scope.
 * @returns Resolves after insertion; the record becomes visible at commit.
 * @throws {Error} Database failures abort the operation.
 * @example
 * ```ts
 * await appendPrivilegedAudit(transaction, event)
 * ```
 */
export async function appendPrivilegedAudit(
  transaction: TenantTransaction,
  event: AuditEvent,
): Promise<void> {
  await transaction.insert(privilegedAudits).values(event);
}
