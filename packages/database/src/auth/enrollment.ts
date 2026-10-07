import type { AuthClient, AuthTransaction } from './client.ts';
import { eq, sql } from 'drizzle-orm';
import { enrollmentAudit, organization, user } from './schema.ts';

export type EnrollmentState = {
  hasOrganization: boolean;
  hasUser: boolean;
  accountExists: boolean;
};

export type EnrollmentAuditEntry = {
  action: string;
  userId: string;
  sessionId: string | null;
};

export function withEnrollmentTransaction<Result>(
  client: AuthClient,
  enroll: (transaction: AuthTransaction) => Promise<Result>,
): Promise<Result> {
  return client.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(706906, 6)`);
    return enroll(transaction);
  });
}

export async function readEnrollmentState(
  transaction: AuthTransaction,
  email: string,
): Promise<EnrollmentState> {
  const [existingOrganization] = await transaction
    .select({ id: organization.id })
    .from(organization)
    .limit(1);
  const [existingUser] = await transaction.select({ id: user.id }).from(user).limit(1);
  const [existingAccount] = await transaction
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return {
    hasOrganization: existingOrganization !== undefined,
    hasUser: existingUser !== undefined,
    accountExists: existingAccount !== undefined,
  };
}

export async function insertEnrollmentAudit(
  transaction: AuthTransaction,
  entry: EnrollmentAuditEntry,
): Promise<void> {
  await transaction.insert(enrollmentAudit).values(entry);
}
