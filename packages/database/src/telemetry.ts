import type { DatabaseRuntime } from './clients.ts';
import { sql } from 'drizzle-orm';
import * as v from 'valibot';

const queueHealthSchema = v.object({
  name: v.picklist(['auth-email', 'delivery-apns', 'delivery-fcm', 'delivery-web-push']),
  pending: v.number(),
  active: v.number(),
  failed: v.number(),
  oldestSeconds: v.number(),
});
const diagnosticsSchema = v.object({
  queuesReady: v.boolean(),
  consumers: v.array(v.picklist(['auth-email', 'apns', 'fcm', 'web-push'])),
  queues: v.array(queueHealthSchema),
  ambiguous: v.number(),
  credentialFailures: v.number(),
  pendingErasures: v.number(),
});
export type DatabaseDiagnostics = v.InferOutput<typeof diagnosticsSchema>;
export type WorkerConsumer = DatabaseDiagnostics['consumers'][number];

/**
 * Reads bounded global counters through an operator-owned database function.
 * Tenant rows, payloads, and provider responses are excluded. Each query times out
 * after one second, including lock waits; pool acquisition uses its configured bound.
 * @param database - API or worker runtime.
 * @returns Queue, recovery, and fresh consumer counts with a fixed set of labels.
 * @throws {Error} Database, schema, privilege, and diagnostic validation failures propagate.
 * @example
 * ```ts
 * const diagnostics = await readDatabaseDiagnostics(database)
 * ```
 */
export async function readDatabaseDiagnostics(
  database: DatabaseRuntime,
): Promise<DatabaseDiagnostics> {
  return database.db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT set_config('statement_timeout','1000',true), set_config('lock_timeout','250',true)`,
    );
    const result = await transaction.execute(sql`SELECT app.runtime_diagnostics() AS diagnostics`);
    return v.parse(v.object({ diagnostics: diagnosticsSchema }), result.rows[0]).diagnostics;
  });
}

/**
 * Publishes a worker lease using database time and removes expired leases.
 * Only consumers that are actually running may be reported. Refresh every 30 seconds.
 * @param database - Worker runtime.
 * @param id - Unique UUID for this process lifetime.
 * @param consumers - Successfully started consumers.
 * @returns Resolves after the 90-second lease is committed.
 * @throws {Error} Database failures propagate; readiness then expires automatically.
 * @example
 * ```ts
 * await publishWorkerHeartbeat(database, processId, ['auth-email'])
 * ```
 */
export async function publishWorkerHeartbeat(
  database: DatabaseRuntime,
  id: string,
  consumers: WorkerConsumer[],
): Promise<void> {
  await database.db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT set_config('statement_timeout','1000',true), set_config('lock_timeout','250',true)`,
    );
    await transaction.execute(
      sql`SELECT app.publish_worker_heartbeat(${id}::uuid, ${sql.param(consumers)}::text[])`,
    );
  });
}

/**
 * Removes a worker lease during shutdown before its database pool closes.
 * @param database - Worker runtime.
 * @param id - This process's lease UUID.
 * @returns Resolves after deletion. Crashed workers instead expire after 90 seconds.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * await removeWorkerHeartbeat(database, processId)
 * ```
 */
export async function removeWorkerHeartbeat(database: DatabaseRuntime, id: string): Promise<void> {
  await database.db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT set_config('statement_timeout','1000',true), set_config('lock_timeout','250',true)`,
    );
    await transaction.execute(sql`DELETE FROM app.worker_heartbeats WHERE id=${id}::uuid`);
  });
}
