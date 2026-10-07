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

/**
 * Serializes enrollment using a transaction-scoped PostgreSQL advisory lock.
 *
 * @param client - Authentication client that owns the transaction.
 * @param enroll - Enrollment operation executed after acquiring the installation-wide lock.
 * @returns Callback result after commit; the lock is released when the transaction ends.
 * @throws {Error} Database or enrollment errors propagate and roll back the transaction.
 *
 * @example
 * ```ts
 * const state = await withEnrollmentTransaction(client,
 *   (transaction) => readEnrollmentState(transaction, email),
 * );
 * ```
 */
export function withEnrollmentTransaction<Result>(
  client: AuthClient,
  enroll: (transaction: AuthTransaction) => Promise<Result>,
): Promise<Result> {
  return client.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(706906, 6)`);
    return enroll(transaction);
  });
}

/**
 * Reads installation and account existence for enrollment decisions.
 *
 * Existing rows count even when soft-deleted. Use inside withEnrollmentTransaction
 * to serialize state checks with account creation.
 *
 * @param transaction - Locked enrollment transaction.
 * @param email - Normalized email parsed by enrollmentActionSchema.
 * @returns Whether any organization, any user, and a user with the supplied email exist.
 * @throws {Error} Database query failures propagate.
 *
 * @example
 * ```ts
 * const state = await readEnrollmentState(transaction, action.email);
 * ```
 */
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

/**
 * Appends an enrollment or privileged authentication audit entry.
 *
 * @param transaction - Authentication transaction containing the associated operation.
 * @param entry - Action, actor ID, and optional session reference to persist.
 * @returns Resolves after inserting the entry.
 * @throws {Error} Database insert failures propagate.
 *
 * @example
 * ```ts
 * await insertEnrollmentAudit(transaction, {
 *   action: 'provision', userId, sessionId: null,
 * });
 * ```
 */
export async function insertEnrollmentAudit(
  transaction: AuthTransaction,
  entry: EnrollmentAuditEntry,
): Promise<void> {
  await transaction.insert(enrollmentAudits).values(entry);
}
