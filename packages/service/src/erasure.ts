import type { DatabaseRuntime } from '@pipong/database';
import type { ErasureReceipt } from '@pipong/database/erasure';
import type { TenantScope, TenantTransaction } from '@pipong/database/tenancy';
import { advanceErasure, readPendingErasures, requestScopeErasure } from '@pipong/database/erasure';
import {
  pruneRetainedData,
  pruneSecurityAudits,
  readRetentionScopes,
} from '@pipong/database/retention';
import { withTenantTransaction } from '@pipong/database/tenancy';

export type { ErasureReceipt } from '@pipong/database/erasure';

/**
 * Requests erasure after owner/admin authorization and recent MFA.
 * Organization deletion requires the owner role. The transaction must hold the
 * target lifecycle row for update; commit immediately blocks new logical sends.
 * @param transaction - Active authorized transaction.
 * @param scope - Scope to suspend and erase.
 * @param actorId - Authenticated human UUID retained in the erasure audit.
 * @returns Durable receipt with the two-minute in-flight settlement deadline.
 * @throws {Error} Database failures roll back the request and suspension together.
 * @example
 * ```ts
 * const receipt = await eraseScope(transaction, scope, principal.userId);
 * ```
 */
export function eraseScope(
  transaction: TenantTransaction,
  scope: TenantScope,
  actorId: string,
): Promise<ErasureReceipt> {
  return requestScopeErasure(transaction, scope, actorId);
}

/**
 * Advances at most ten erasure jobs, each in its own bounded transaction.
 * Workers call this every minute and on startup. Progress survives restart;
 * concurrent workers serialize through the owning organization's lifecycle lock.
 * @param database - Worker runtime; API accounts cannot discover cleanup jobs.
 * @returns Number of unfinished jobs processed.
 * @throws {Error} Discovery failures propagate. Failed batches retain their progress and retry on the next scan.
 * @example
 * ```ts
 * await processErasures(database);
 * ```
 */
export async function processErasures(database: DatabaseRuntime): Promise<number> {
  const jobs = await readPendingErasures(database);
  let processed = 0;
  // oxlint-disable eslint/no-await-in-loop -- Each bounded batch commits independently in lifecycle lock order.
  for (const { id, organizationId } of jobs) {
    try {
      if (
        await withTenantTransaction(
          database,
          { kind: 'organization', organizationId },
          (transaction) => advanceErasure(transaction, id),
        )
      ) {
        processed += 1;
      }
    } catch {
      console.error('ERASURE_BATCH_FAILED: cleanup will retry on the next scan');
    }
  }
  // oxlint-enable eslint/no-await-in-loop
  return processed;
}

/**
 * Prunes expired payloads, attempts, replay records, events, and security audits.
 * Every environment batch owns a separate transaction and survives worker restart.
 * @param database - Worker database runtime.
 * @returns Resolves after at most ten environment batches and one global audit batch.
 * @throws {Error} Discovery and audit failures propagate. Failed environment batches retry on the next scan.
 * @example
 * ```ts
 * await processRetention(database);
 * ```
 */
export async function processRetention(database: DatabaseRuntime): Promise<void> {
  const scopes = await readRetentionScopes(database);
  // oxlint-disable eslint/no-await-in-loop -- Each bounded retention batch commits independently.
  for (const scope of scopes) {
    try {
      await withTenantTransaction(database, scope, (transaction) =>
        pruneRetainedData(transaction, scope),
      );
    } catch {
      console.error('RETENTION_BATCH_FAILED: cleanup will retry on the next scan');
    }
  }
  // oxlint-enable eslint/no-await-in-loop
  await pruneSecurityAudits(database);
}
