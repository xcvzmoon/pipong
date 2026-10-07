import type { AuthClient, AuthTransaction } from './client.ts';
import type { EnrollmentAuditEntry } from './enrollment.ts';
import { and, eq, gt } from 'drizzle-orm';
import { insertEnrollmentAudit } from './enrollment.ts';
import { mfaAssurances } from './schema.ts';

export type MfaVerification = { sessionId: string; verifiedAt: Date };

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
