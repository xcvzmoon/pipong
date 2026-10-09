import type { AdmissionDecision } from '@pipong/database/limits';
import type { TenantTransaction } from '@pipong/database/tenancy';
import { reserveAdmission, settleAdmission } from '@pipong/database/limits';
import * as v from 'valibot';

const idSchema = v.pipe(v.string(), v.uuid());
const countSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2147483647));
const admissionInputSchema = v.strictObject({
  organizationId: idSchema,
  keyId: v.nullable(idSchema),
  reservationId: idSchema,
  endpoints: countSchema,
});

export type { AdmissionDecision, TenantBudget } from '@pipong/database/limits';

/**
 * Validates and reserves tenant capacity before acceptance writes and queue insertion.
 * The caller must authorize the organization and key and check the idempotency fingerprint
 * before replay. Keep all acceptance writes in this transaction; abort it on enqueue failure.
 * @param transaction - Authorized acceptance transaction.
 * @param organizationId - Authorized organization ID.
 * @param keyId - Verified key ID, or null for a human request.
 * @param reservationId - Stable notification acceptance ID.
 * @param endpoints - Deduplicated endpoint count.
 * @returns Admission decision; map rejections to HTTP 429 and Retry-After.
 * @throws {Error} ADMISSION_INPUT_INVALID for invalid identifiers/counts. Repository and database errors propagate.
 * @example
 * ```ts
 * const decision = await admitNotification(transaction, organizationId, keyId, notificationId, 5);
 * ```
 */
export function admitNotification(
  transaction: TenantTransaction,
  organizationId: string,
  keyId: string | null,
  reservationId: string,
  endpoints: number,
): Promise<AdmissionDecision> {
  const parsed = v.safeParse(admissionInputSchema, {
    organizationId,
    keyId,
    reservationId,
    endpoints,
  });
  if (!parsed.success) {
    throw new Error('ADMISSION_INPUT_INVALID: invalid admission identifiers or endpoint count');
  }
  return reserveAdmission(transaction, organizationId, keyId, reservationId, endpoints);
}

/**
 * Releases pending capacity as part of fenced delivery settlement.
 * Derive the remaining count from locked persisted state, including retry successors.
 * @param transaction - Worker transaction containing terminal state and event writes.
 * @param organizationId - Owning organization ID.
 * @param reservationId - Original acceptance ID.
 * @param remaining - Number of nonterminal deliveries, including pending retries.
 * @returns Resolves after pending accounting is reconciled. Repeated counts are idempotent.
 * @throws {Error} ADMISSION_INPUT_INVALID for invalid input. Repository and database errors propagate.
 * @example
 * ```ts
 * await releaseNotificationCapacity(transaction, organizationId, notificationId, 0);
 * ```
 */
export function releaseNotificationCapacity(
  transaction: TenantTransaction,
  organizationId: string,
  reservationId: string,
  remaining: number,
): Promise<void> {
  const parsed = v.safeParse(admissionInputSchema, {
    organizationId,
    keyId: null,
    reservationId,
    endpoints: remaining,
  });
  if (!parsed.success) {
    throw new Error('ADMISSION_INPUT_INVALID: invalid settlement identifiers or remaining count');
  }
  return settleAdmission(transaction, organizationId, reservationId, remaining);
}
