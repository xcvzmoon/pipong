import type { EnvironmentScope } from '../recipients/index.ts';
import type { TenantTransaction } from '../tenancy/index.ts';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { environments } from '../tenancy/schema.ts';
import { credentialVersions } from './schema.ts';

export type CredentialRecord = typeof credentialVersions.$inferSelect;
export type CredentialInsert = typeof credentialVersions.$inferInsert;
export type CredentialMetadata = Omit<CredentialRecord, 'encryptedSecret'>;

const metadataColumns = {
  id: credentialVersions.id,
  organizationId: credentialVersions.organizationId,
  projectId: credentialVersions.projectId,
  environmentId: credentialVersions.environmentId,
  provider: credentialVersions.provider,
  appId: credentialVersions.appId,
  publicKey: credentialVersions.publicKey,
  state: credentialVersions.state,
  createdAt: credentialVersions.createdAt,
  retiredAt: credentialVersions.retiredAt,
};

function credentialScope(scope: EnvironmentScope): ReturnType<typeof and> {
  return and(
    eq(credentialVersions.organizationId, scope.organizationId),
    eq(credentialVersions.projectId, scope.projectId),
    eq(credentialVersions.environmentId, scope.environmentId),
  );
}

/**
 * Inserts an encrypted immutable provider version; plaintext must never reach this function.
 * @param transaction - Authorized credential:manage transaction.
 * @param input - Immutable version and encrypted envelope.
 * @returns Public metadata without the encrypted envelope.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const metadata = await insertCredential(transaction, input);
 * ```
 */
export async function insertCredential(
  transaction: TenantTransaction,
  input: CredentialInsert,
): Promise<CredentialMetadata> {
  const [record] = await transaction
    .insert(credentialVersions)
    .values(input)
    .returning(metadataColumns);

  if (!record) {
    throw new Error('CREDENTIAL_INSERT_FAILED: no credential inserted');
  }

  return record;
}

/**
 * Reads encrypted material only for internal encryption/provider operations.
 * @param transaction - Authorized tenant transaction.
 * @param scope - Owning environment.
 * @param id - Immutable credential version UUID.
 * @returns Internal record, or undefined when absent or out of scope.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const record = await readCredential(transaction, scope, id);
 * ```
 */
export async function readCredential(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  id: string,
): Promise<CredentialRecord | undefined> {
  const [record] = await transaction
    .select()
    .from(credentialVersions)
    .where(and(credentialScope(scope), eq(credentialVersions.id, id)))
    .for('update');
  return record;
}

/**
 * Reads only public metadata without locking or loading the encryption envelope.
 * @param transaction - Authorized credential:read or endpoint:read transaction.
 * @param scope - Owning environment.
 * @param id - Credential UUID.
 * @returns Public metadata or undefined when absent.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const record = await readCredentialMetadata(transaction, scope, id);
 * ```
 */
export async function readCredentialMetadata(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  id: string,
): Promise<CredentialMetadata | undefined> {
  const [record] = await transaction
    .select(metadataColumns)
    .from(credentialVersions)
    .where(and(credentialScope(scope), eq(credentialVersions.id, id)));
  return record;
}

/**
 * Lists credential metadata without selecting encrypted material.
 * @param transaction - Authorized credential:read transaction.
 * @param scope - Owning environment.
 * @param limit - Maximum number of rows.
 * @param afterId - Exclusive cursor UUID, or undefined for the first page.
 * @returns Ordered public metadata.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const records = await listCredentialMetadata(transaction, scope, 51, undefined);
 * ```
 */
export function listCredentialMetadata(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  limit: number,
  afterId: string | undefined,
): Promise<CredentialMetadata[]> {
  return transaction
    .select(metadataColumns)
    .from(credentialVersions)
    .where(and(credentialScope(scope), afterId ? gt(credentialVersions.id, afterId) : undefined))
    .orderBy(asc(credentialVersions.id))
    .limit(limit);
}

/**
 * Serializes credential lifecycle changes within an environment.
 * @param transaction - Authorized tenant transaction.
 * @param scope - Owning environment.
 * @returns Resolves after acquiring the environment row lock.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * await lockCredentialEnvironment(transaction, scope);
 * ```
 */
export async function lockCredentialEnvironment(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
): Promise<void> {
  await transaction
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.organizationId, scope.organizationId),
        eq(environments.projectId, scope.projectId),
        eq(environments.id, scope.environmentId),
      ),
    )
    .for('update');
}

/**
 * Activates or retires a version after the caller locks and checks its current state.
 * Activation makes the previous active version inactive; it remains available for pinned work.
 * @param transaction - Authorized credential:manage transaction with environment lock held.
 * @param record - Version selected within that environment.
 * @param state - Requested terminal retirement or activation.
 * @returns Updated metadata.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const metadata = await changeCredentialState(transaction, record, 'active');
 * ```
 */
export async function changeCredentialState(
  transaction: TenantTransaction,
  record: CredentialRecord,
  state: 'active' | 'retired',
): Promise<CredentialMetadata> {
  const scope = { kind: 'environment', ...record } as const;

  if (state === 'active') {
    await transaction
      .update(credentialVersions)
      .set({ state: 'inactive' })
      .where(
        and(
          credentialScope(scope),
          eq(credentialVersions.provider, record.provider),
          eq(credentialVersions.appId, record.appId),
          eq(credentialVersions.state, 'active'),
        ),
      );
  }

  const [metadata] = await transaction
    .update(credentialVersions)
    .set({ state, retiredAt: state === 'retired' ? sql`now()` : null })
    .where(and(credentialScope(scope), eq(credentialVersions.id, record.id)))
    .returning(metadataColumns);

  if (!metadata) {
    throw new Error('CREDENTIAL_UPDATE_FAILED: version disappeared');
  }

  return metadata;
}

/**
 * Replaces only an encryption envelope while retaining the immutable provider version.
 * @param transaction - Authorized transaction holding the version lock.
 * @param record - Locked version.
 * @param encryptedSecret - Reauthenticated secret under the current active encryption key.
 * @returns Resolves after storage is updated.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * await replaceCredentialEnvelope(transaction, record, encrypted);
 * ```
 */
export async function replaceCredentialEnvelope(
  transaction: TenantTransaction,
  record: CredentialRecord,
  encryptedSecret: string,
): Promise<void> {
  await transaction
    .update(credentialVersions)
    .set({ encryptedSecret })
    .where(eq(credentialVersions.id, record.id));
}
