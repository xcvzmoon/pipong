import type { TenantTransaction } from './tenancy/index.ts';
import { and, eq, sql } from 'drizzle-orm';
import { admissionReservations, keyBudgets, tenantBudgets } from './limits-schema.ts';

export type TenantBudget = typeof tenantBudgets.$inferSelect;
export type AdmissionDecision =
  | { status: 'accepted'; replay: boolean }
  | {
      status: 'rejected';
      code:
        | 'ADMISSION_REQUEST_LIMIT'
        | 'ADMISSION_KEY_LIMIT'
        | 'ADMISSION_FANOUT_LIMIT'
        | 'ADMISSION_PENDING_LIMIT';
      retryAfter: number;
    };

/**
 * Reserves one request and its endpoint work under the organization's budget lock.
 * Use the same authorized transaction for acceptance, events, and queue insertion.
 * Reusing a reservation charges only the request; first verify its idempotency fingerprint.
 * Only operators may change persisted limits. New tenants receive the database defaults.
 * @param transaction - Authorized tenant transaction; locks remain held until it ends.
 * @param organizationId - Owning organization.
 * @param keyId - Authenticated service key ID, or null for a human request.
 * @param reservationId - Stable acceptance identity, reused only for identical accepted requests.
 * @param endpoints - Validated nonnegative endpoint count after target deduplication.
 * @returns Accepted/replayed reservation or rejection with retry seconds. Admitted requests consume request capacity even when fanout or backlog rejects; rejected work consumes no delivery capacity.
 * @throws {Error} ADMISSION_UNAVAILABLE for missing tenant state; ADMISSION_RESERVATION_CONFLICT for changed endpoint counts. Database failures propagate.
 * @example
 * ```ts
 * const decision = await reserveAdmission(transaction, organizationId, keyId, notificationId, 3);
 * ```
 */
export async function reserveAdmission(
  transaction: TenantTransaction,
  organizationId: string,
  keyId: string | null,
  reservationId: string,
  endpoints: number,
): Promise<AdmissionDecision> {
  let [budget] = await transaction
    .select()
    .from(tenantBudgets)
    .where(eq(tenantBudgets.organizationId, organizationId))
    .for('update');
  if (!budget) {
    await transaction.execute(
      sql`INSERT INTO app.tenant_budgets (organization_id) VALUES (${organizationId}::uuid) ON CONFLICT DO NOTHING`,
    );
    [budget] = await transaction
      .select()
      .from(tenantBudgets)
      .where(eq(tenantBudgets.organizationId, organizationId))
      .for('update');
  }
  if (!budget) {
    throw new Error('ADMISSION_UNAVAILABLE: tenant budget is unavailable');
  }
  const [reservation] = await transaction
    .select()
    .from(admissionReservations)
    .where(
      and(
        eq(admissionReservations.organizationId, organizationId),
        eq(admissionReservations.id, reservationId),
      ),
    );
  if (reservation) {
    if (reservation.endpoints !== endpoints) {
      throw new Error('ADMISSION_RESERVATION_CONFLICT: endpoint count changed');
    }
  }
  const [clock] = await transaction
    .select({ now: sql`clock_timestamp()`.mapWith(tenantBudgets.windowStart) })
    .from(tenantBudgets)
    .where(eq(tenantBudgets.organizationId, organizationId));
  if (!clock) {
    throw new Error('ADMISSION_UNAVAILABLE: database clock is unavailable');
  }
  const expired = clock.now.getTime() >= budget.windowStart.getTime() + budget.windowSeconds * 1000;
  const windowStart = expired ? clock.now : budget.windowStart;
  const requests = expired ? 0 : budget.requests;
  const fanout = expired ? 0 : budget.fanout;
  const retryAfter = Math.max(
    1,
    Math.ceil((windowStart.getTime() + budget.windowSeconds * 1000 - clock.now.getTime()) / 1000),
  );
  if (requests >= budget.requestLimit) {
    return { status: 'rejected', code: 'ADMISSION_REQUEST_LIMIT', retryAfter };
  }
  let keyRequests = 0;
  if (keyId !== null) {
    const [key] = await transaction
      .select()
      .from(keyBudgets)
      .where(and(eq(keyBudgets.organizationId, organizationId), eq(keyBudgets.keyId, keyId)));
    keyRequests = key?.windowStart.getTime() === windowStart.getTime() ? key.requests : 0;
    if (keyRequests >= budget.keyRequestLimit) {
      return { status: 'rejected', code: 'ADMISSION_KEY_LIMIT', retryAfter };
    }
  }
  await transaction
    .update(tenantBudgets)
    .set({
      windowStart,
      requests: requests + 1,
      fanout,
    })
    .where(eq(tenantBudgets.organizationId, organizationId));
  if (keyId !== null) {
    await transaction
      .insert(keyBudgets)
      .values({ organizationId, keyId, windowStart, requests: keyRequests + 1 })
      .onConflictDoUpdate({
        target: [keyBudgets.organizationId, keyBudgets.keyId],
        set: { windowStart, requests: keyRequests + 1 },
      });
  }
  if (reservation) {
    return { status: 'accepted', replay: true };
  }
  if (endpoints > budget.fanoutLimit - fanout) {
    return { status: 'rejected', code: 'ADMISSION_FANOUT_LIMIT', retryAfter };
  }
  if (endpoints > budget.pendingLimit - budget.pending) {
    return { status: 'rejected', code: 'ADMISSION_PENDING_LIMIT', retryAfter: 1 };
  }
  await transaction
    .update(tenantBudgets)
    .set({ fanout: fanout + endpoints, pending: budget.pending + endpoints })
    .where(eq(tenantBudgets.organizationId, organizationId));
  await transaction
    .insert(admissionReservations)
    .values({ organizationId, id: reservationId, endpoints, remaining: endpoints });
  return { status: 'accepted', replay: false };
}

/**
 * Reconciles a reservation's remaining nonterminal work in its settlement transaction.
 * The caller must derive remaining work from persisted delivery state under its locks.
 * Repeated settlement with the same count releases nothing twice. Retry successors
 * retain their pending slot; terminal outcomes release it.
 * @param transaction - Worker transaction containing the fenced delivery settlement.
 * @param organizationId - Owning organization.
 * @param reservationId - Original acceptance reservation.
 * @param remaining - Validated nonnegative count, no greater than its previous value.
 * @returns Resolves after released slots and the reservation are updated together.
 * @throws {Error} ADMISSION_RESERVATION_INVALID when the reservation is missing or remaining work increases. Database failures propagate.
 * @example
 * ```ts
 * await settleAdmission(transaction, organizationId, notificationId, 0);
 * ```
 */
export async function settleAdmission(
  transaction: TenantTransaction,
  organizationId: string,
  reservationId: string,
  remaining: number,
): Promise<void> {
  const [budget] = await transaction
    .select()
    .from(tenantBudgets)
    .where(eq(tenantBudgets.organizationId, organizationId))
    .for('update');
  const predicate = and(
    eq(admissionReservations.organizationId, organizationId),
    eq(admissionReservations.id, reservationId),
  );
  const [reservation] = await transaction.select().from(admissionReservations).where(predicate);
  if (!budget || !reservation || remaining > reservation.remaining) {
    throw new Error('ADMISSION_RESERVATION_INVALID: invalid remaining work');
  }
  await transaction
    .update(tenantBudgets)
    .set({ pending: budget.pending - (reservation.remaining - remaining) })
    .where(eq(tenantBudgets.organizationId, organizationId));
  await transaction.update(admissionReservations).set({ remaining }).where(predicate);
}
