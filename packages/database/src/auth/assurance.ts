import type { AuthClient, AuthTransaction } from './client.ts';
import type { EnrollmentAuditEntry } from './enrollment.ts';
import { and, eq, gt } from 'drizzle-orm';
import { insertEnrollmentAudit } from './enrollment.ts';
import { mfaAssurances } from './schema.ts';

export type MfaVerification = { sessionId: string; verifiedAt: Date };

/**
 * Checks whether a session has MFA verification strictly after the supplied cutoff.
 *
 * @param client - Authentication client or transaction.
 * @param sessionId - Session whose verification is being checked.
 * @param after - Exclusive verification cutoff.
 * @returns True when an assurance record is newer than the cutoff. This does not check session validity.
 * @throws {Error} Database query failures propagate.
 *
 * @example
 * ```ts
 * const recent = await hasMfaAssurance(client, sessionId,
 *   new Date(Date.now() - 300_000),
 * );
 * ```
 */
export async function hasMfaAssurance(
  client: AuthClient | AuthTransaction,
  sessionId: string,
  after: Date,
): Promise<boolean> {
  const [assurance] = await client
    .select({ sessionId: mfaAssurances.sessionId })
    .from(mfaAssurances)
    .where(and(eq(mfaAssurances.sessionId, sessionId), gt(mfaAssurances.verifiedAt, after)));
  return assurance !== undefined;
}

/**
 * Records MFA assurance and an optional audit entry atomically.
 *
 * @param client - Authentication client or transaction used to start the operation.
 * @param verifications - Session verification to upsert, or undefined to leave assurance unchanged.
 * @param audit - Audit entry to insert, or undefined to skip auditing.
 * @returns Resolves after the supplied records are committed within the operation's transaction.
 * @throws {Error} Database failures propagate and roll back both writes.
 *
 * @example
 * ```ts
 * await recordAuthActivity(client, { sessionId, verifiedAt: new Date() }, undefined);
 * ```
 */
export async function recordAuthActivity(
  client: AuthClient | AuthTransaction,
  verifications: MfaVerification | undefined,
  audit: EnrollmentAuditEntry | undefined,
): Promise<void> {
  await client.transaction(async (transaction) => {
    if (verifications) {
      await transaction
        .insert(mfaAssurances)
        .values(verifications)
        .onConflictDoUpdate({
          target: mfaAssurances.sessionId,
          set: { verifiedAt: verifications.verifiedAt },
        });
    }
    if (audit) await insertEnrollmentAudit(transaction, audit);
  });
}
