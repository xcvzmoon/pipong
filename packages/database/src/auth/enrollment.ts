import type { AuthClient, AuthTransaction } from './client.ts';
import { eq, sql } from 'drizzle-orm';
import { enrollmentAudits, organizations, users } from './schema.ts';

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
    .select({ id: organizations.id })
    .from(organizations)
    .limit(1);
  const [existingUser] = await transaction.select({ id: users.id }).from(users).limit(1);
  const [existingAccount] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
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
  await transaction.insert(enrollmentAudits).values(entry);
}
