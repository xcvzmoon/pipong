import type { AuthClient, AuthTransaction } from './client.ts';
import type { EnrollmentAuditEntry } from './enrollment.ts';
import { and, eq, gt } from 'drizzle-orm';
import { insertEnrollmentAudit } from './enrollment.ts';
import { mfaAssurance } from './schema.ts';

export type MfaVerification = { sessionId: string; verifiedAt: Date };

export async function hasMfaAssurance(
  client: AuthClient | AuthTransaction,
  sessionId: string,
  after: Date,
): Promise<boolean> {
  const [assurance] = await client
    .select({ sessionId: mfaAssurance.sessionId })
    .from(mfaAssurance)
    .where(and(eq(mfaAssurance.sessionId, sessionId), gt(mfaAssurance.verifiedAt, after)));
  return assurance !== undefined;
}

export async function recordAuthActivity(
  client: AuthClient | AuthTransaction,
  verification: MfaVerification | undefined,
  audit: EnrollmentAuditEntry | undefined,
): Promise<void> {
  await client.transaction(async (transaction) => {
    if (verification) {
      await transaction
        .insert(mfaAssurance)
        .values(verification)
        .onConflictDoUpdate({
          target: mfaAssurance.sessionId,
          set: { verifiedAt: verification.verifiedAt },
        });
    }
    if (audit) await insertEnrollmentAudit(transaction, audit);
  });
}
