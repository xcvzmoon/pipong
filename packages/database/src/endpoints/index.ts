import type { EnvironmentScope } from '../recipients/index.ts';
import type { TenantTransaction } from '../tenancy/index.ts';
import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { recipients } from '../recipients/schema.ts';
import { endpointGenerations, endpoints } from './schema.ts';

export type EndpointRecord = typeof endpoints.$inferSelect;
export type EndpointMetadata = Omit<EndpointRecord, 'targetHash'>;
export type EndpointInsert = typeof endpoints.$inferInsert;
export type EndpointGenerationInsert = typeof endpointGenerations.$inferInsert;

const endpointConflictSchema = v.object({
  code: v.literal('23505'),
  constraint: v.picklist(['endpoints_active_target_unique', 'endpoints_installation_unique']),
});

const metadataColumns = {
  id: endpoints.id,
  organizationId: endpoints.organizationId,
  projectId: endpoints.projectId,
  environmentId: endpoints.environmentId,
  recipientId: endpoints.recipientId,
  installationId: endpoints.installationId,
  provider: endpoints.provider,
  appId: endpoints.appId,
  generation: endpoints.generation,
  credentialId: endpoints.credentialId,
  state: endpoints.state,
  registeredAt: endpoints.registeredAt,
  disabledAt: endpoints.disabledAt,
  createdAt: endpoints.createdAt,
};

function endpointScope(scope: EnvironmentScope): ReturnType<typeof and> {
  return and(
    eq(endpoints.organizationId, scope.organizationId),
    eq(endpoints.projectId, scope.projectId),
    eq(endpoints.environmentId, scope.environmentId),
  );
}

/**
 * Locks an active recipient before endpoint mutations, serializing them with deletion.
 * @param transaction - Authorized tenant transaction.
 * @param scope - Owning environment.
 * @param recipientId - Recipient UUID.
 * @returns Whether the recipient is active in this scope.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const active = await lockEndpointRecipient(transaction, scope, recipientId);
 * ```
 */
export async function lockEndpointRecipient(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  recipientId: string,
): Promise<boolean> {
  const [record] = await transaction
    .select({ id: recipients.id })
    .from(recipients)
    .where(
      and(
        eq(recipients.organizationId, scope.organizationId),
        eq(recipients.projectId, scope.projectId),
        eq(recipients.environmentId, scope.environmentId),
        eq(recipients.id, recipientId),
        isNull(recipients.deletedAt),
      ),
    )
    .for('update');
  return record !== undefined;
}

/**
 * Locks an installation identity. Its recipient and provider binding cannot change.
 * @param transaction - Authorized transaction holding the recipient lock.
 * @param scope - Owning environment.
 * @param provider - Provider discriminant.
 * @param appId - Provider application identity.
 * @param installationId - Validated installation identity.
 * @returns The current endpoint, or undefined for a new installation.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const record = await readEndpointInstallation(transaction, scope, 'fcm', 'app-id', 'phone-1');
 * ```
 */
export async function readEndpointInstallation(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  provider: EndpointRecord['provider'],
  appId: string,
  installationId: string,
): Promise<EndpointRecord | undefined> {
  const [record] = await transaction
    .select()
    .from(endpoints)
    .where(
      and(
        endpointScope(scope),
        eq(endpoints.provider, provider),
        eq(endpoints.appId, appId),
        eq(endpoints.installationId, installationId),
      ),
    )
    .for('update');
  return record;
}

/**
 * Persists a registration and its immutable encrypted generation in one transaction.
 * @param transaction - Authorized transaction holding recipient and credential locks.
 * @param input - Current endpoint metadata and target hash.
 * @param generation - Encrypted snapshot of this registration.
 * @returns Redacted metadata without target identifiers or ciphertext.
 * @throws {Error} Database failures, including scoped target conflicts, roll back both rows. HTTP callers map uniqueness failures with isEndpointConflict.
 * @example
 * ```ts
 * const record = await persistEndpointRegistration(transaction, input, generation);
 * ```
 */
export async function persistEndpointRegistration(
  transaction: TenantTransaction,
  input: EndpointInsert,
  generation: EndpointGenerationInsert,
): Promise<EndpointMetadata> {
  const [record] = await transaction
    .insert(endpoints)
    .values(input)
    .onConflictDoUpdate({
      target: endpoints.id,
      set: {
        generation: input.generation,
        credentialId: input.credentialId,
        targetHash: input.targetHash,
        registeredAt: input.registeredAt,
        state: 'active',
        disabledAt: null,
      },
    })
    .returning(metadataColumns);
  if (!record) {
    throw new Error('ENDPOINT_INSERT_FAILED: registration disappeared');
  }
  await transaction.insert(endpointGenerations).values(generation);
  return record;
}

/**
 * Lists redacted endpoint metadata for one active recipient.
 * @param transaction - Authorized endpoint:read transaction.
 * @param scope - Owning environment.
 * @param recipientId - Active recipient UUID.
 * @param limit - Maximum records to fetch.
 * @param afterId - Exclusive UUID boundary, or undefined for the first page.
 * @returns Ordered metadata, including disabled endpoints.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const records = await listEndpointMetadata(transaction, scope, recipientId, 51, undefined);
 * ```
 */
export function listEndpointMetadata(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  recipientId: string,
  limit: number,
  afterId: string | undefined,
): Promise<EndpointMetadata[]> {
  return transaction
    .select(metadataColumns)
    .from(endpoints)
    .where(
      and(
        endpointScope(scope),
        eq(endpoints.recipientId, recipientId),
        afterId ? gt(endpoints.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(endpoints.id))
    .limit(limit);
}

/**
 * Reads one endpoint without loading token hashes or encrypted material.
 * @param transaction - Authorized endpoint:read transaction.
 * @param scope - Owning environment.
 * @param recipientId - Active recipient UUID.
 * @param id - Endpoint UUID.
 * @returns Metadata, or undefined for a missing or mismatched endpoint.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const record = await readEndpointMetadata(transaction, scope, recipientId, id);
 * ```
 */
export async function readEndpointMetadata(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  recipientId: string,
  id: string,
): Promise<EndpointMetadata | undefined> {
  const [record] = await transaction
    .select(metadataColumns)
    .from(endpoints)
    .where(and(endpointScope(scope), eq(endpoints.recipientId, recipientId), eq(endpoints.id, id)));
  return record;
}

/**
 * Disables only the selected generation; newer registrations survive old provider failures.
 * @param transaction - Authorized transaction holding the recipient lock.
 * @param scope - Owning environment.
 * @param recipientId - Recipient UUID.
 * @param id - Endpoint UUID.
 * @param generation - Attempted or explicitly selected generation.
 * @param invalidatedAt - APNs invalidation timestamp, or undefined for other providers/manual disable.
 * @returns Disabled metadata, or undefined when the generation or timestamp is stale.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const record = await disableEndpointGeneration(transaction, scope, recipientId, id, 2, undefined);
 * ```
 */
export async function disableEndpointGeneration(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  recipientId: string,
  id: string,
  generation: number,
  invalidatedAt: Date | undefined,
): Promise<EndpointMetadata | undefined> {
  const [record] = await transaction
    .update(endpoints)
    .set({ state: 'disabled', disabledAt: sql`coalesce(${endpoints.disabledAt}, now())` })
    .where(
      and(
        endpointScope(scope),
        eq(endpoints.recipientId, recipientId),
        eq(endpoints.id, id),
        eq(endpoints.generation, generation),
        invalidatedAt ? lte(endpoints.registeredAt, invalidatedAt) : undefined,
      ),
    )
    .returning(metadataColumns);
  return record;
}

/**
 * Recognizes endpoint uniqueness conflicts without exposing provider identifiers.
 * @param error - Drizzle error wrapping a PostgreSQL constraint failure.
 * @returns True for a scoped endpoint installation or active-target conflict.
 * @example
 * ```ts
 * if (error instanceof Error && isEndpointConflict(error)) console.warn('ENDPOINT_TARGET_CONFLICT');
 * ```
 */
export function isEndpointConflict(error: Error): boolean {
  return v.safeParse(endpointConflictSchema, error.cause).success;
}
