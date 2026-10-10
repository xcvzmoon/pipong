import type { DatabaseRuntime } from './clients.ts';
import type { EnvironmentScope } from './recipients/index.ts';
import type { TenantTransaction } from './tenancy/index.ts';
import { sql } from 'drizzle-orm';
import * as v from 'valibot';
import { pruneDeliveryEvents } from './events.ts';

export type RetentionPolicy = { payloadDays: 30; replayDays: 7; auditDays: 90; batchSize: 100 };
export const retentionPolicy: RetentionPolicy = {
  payloadDays: 30,
  replayDays: 7,
  auditDays: 90,
  batchSize: 100,
};

/**
 * Discovers at most ten environments with expired retained data.
 * @param database - Worker runtime.
 * @returns Validated environment scopes containing expired rows.
 * @throws {Error} Database and stored scope validation failures propagate.
 * @example
 * ```ts
 * const scopes = await readRetentionScopes(database);
 * ```
 */
export async function readRetentionScopes(database: DatabaseRuntime): Promise<EnvironmentScope[]> {
  const result = await database.pool.query(
    'SELECT \'environment\' AS kind, organization_id AS "organizationId", project_id AS "projectId", environment_id AS "environmentId" FROM app.retention_scopes()',
  );
  return v.parse(
    v.array(
      v.object({
        kind: v.literal('environment'),
        organizationId: v.pipe(v.string(), v.uuid()),
        projectId: v.pipe(v.string(), v.uuid()),
        environmentId: v.pipe(v.string(), v.uuid()),
      }),
    ),
    result.rows,
  );
}

/**
 * Removes expired data in bounded batches while preserving unresolved sends.
 * Payloads and settled attempt details expire after 30 days, replay after seven,
 * and redrive audits after 90. Technical delivery counts and tombstones remain.
 * @param transaction - Worker transaction with environment context.
 * @param scope - Environment being pruned.
 * @returns Resolves after all retention writes and the event watermark commit together.
 * @throws {Error} Database failures roll back the batch.
 * @example
 * ```ts
 * await pruneRetainedData(transaction, scope);
 * ```
 */
export async function pruneRetainedData(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
): Promise<void> {
  await transaction.execute(
    sql`SELECT set_config('statement_timeout','5000',true), set_config('lock_timeout','1000',true)`,
  );
  await transaction.execute(
    sql`SELECT app.lock_delivery_organization(${scope.organizationId}::uuid)`,
  );
  await transaction.execute(sql`SELECT app.erase_notification_payloads(NULL, true)`);
  await transaction.execute(sql`SELECT app.prune_attempts()`);
  await transaction.execute(
    sql`DELETE FROM app.idempotency_records WHERE ctid IN (SELECT ctid FROM app.idempotency_records WHERE expires_at <= clock_timestamp() ORDER BY expires_at,key LIMIT 100)`,
  );
  await transaction.execute(
    sql`DELETE FROM app.delivery_redrives WHERE source_delivery_id IN (SELECT source_delivery_id FROM app.delivery_redrives WHERE created_at < clock_timestamp()-interval '90 days' ORDER BY created_at,source_delivery_id LIMIT 100)`,
  );
  await pruneDeliveryEvents(transaction, scope);
}

/**
 * Prunes at most 100 expired rows from each global audit table.
 * @param database - Worker runtime; ordinary API accounts cannot invoke this function.
 * @returns Resolves after completed erasure, enrollment, and key audits older than 90 days are removed.
 * @throws {Error} Database failures roll back the audit batch.
 * @example
 * ```ts
 * await pruneSecurityAudits(database);
 * ```
 */
export async function pruneSecurityAudits(database: DatabaseRuntime): Promise<void> {
  await database.db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT set_config('statement_timeout','5000',true), set_config('lock_timeout','1000',true)`,
    );
    await transaction.execute(sql`SELECT app.prune_security_audits()`);
    await transaction.execute(sql`SELECT app.prune_privileged_audits()`);
  });
}
