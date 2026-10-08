import type { EndpointMetadata } from '@pipong/database/endpoints';
import type { EnvironmentScope } from '@pipong/database/recipients';
import type { TenantTransaction } from '@pipong/database/tenancy';
import type { EgressPolicy } from './egress.ts';
import type { ResourcePage, ResourceResult } from './resources.ts';
import type { SecretKeyring } from './secrets.ts';
import { readCredential } from '@pipong/database/credentials';
import {
  disableEndpointGeneration,
  listEndpointMetadata,
  lockEndpointRecipient,
  persistEndpointRegistration,
  readEndpointInstallation,
  readEndpointMetadata,
} from '@pipong/database/endpoints';
import { readRecipient } from '@pipong/database/recipients';
import { createHash, ECDH, randomUUID } from 'node:crypto';
import * as v from 'valibot';
import { credentialInputSchema } from './credentials.ts';
import { validateDestination } from './egress.ts';
import { recipientPathSchema } from './recipients.ts';
import { readResourceCursor, resourcePage } from './resources.ts';
import { decryptSecret, encryptSecret } from './secrets.ts';

const identitySchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9._-]{1,200}$/));
const registrationFields = {
  installationId: identitySchema,
  credentialId: v.pipe(v.string(), v.uuid()),
  appId: identitySchema,
};
const publicKeySchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{87}$/),
  v.check((value) => {
    try {
      const bytes = Buffer.from(value, 'base64url');
      return (
        bytes.length === 65 &&
        bytes[0] === 4 &&
        bytes.toString('base64url') === value &&
        ECDH.convertKey(bytes, 'prime256v1').equals(bytes)
      );
    } catch {
      return false;
    }
  }, 'Must be a canonical uncompressed P-256 public key'),
);
const tokenSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_:.-]{1,4096}$/));

/**
 * Validates provider-specific endpoint registration without accepting tenant policy.
 * @example
 * ```ts
 * const input = v.parse(endpointInputSchema, requestBody);
 * ```
 */
export const endpointInputSchema = v.variant('provider', [
  v.strictObject({
    ...registrationFields,
    provider: v.literal('apns'),
    target: v.strictObject({
      token: v.pipe(v.string(), v.regex(/^(?:[a-fA-F0-9]{2}){1,512}$/), v.toLowerCase()),
      environment: v.picklist(['production', 'sandbox']),
    }),
  }),
  v.strictObject({
    ...registrationFields,
    provider: v.literal('fcm'),
    target: v.variant('kind', [
      v.strictObject({
        kind: v.literal('fid'),
        value: v.pipe(v.string(), v.regex(/^[cdef][A-Za-z0-9_-]{21}$/)),
      }),
      v.strictObject({ kind: v.literal('registration-token'), value: tokenSchema }),
    ]),
  }),
  v.strictObject({
    ...registrationFields,
    provider: v.literal('web-push'),
    target: v.strictObject({
      endpoint: v.pipe(v.string(), v.url(), v.maxLength(4096)),
      p256dh: publicKeySchema,
      auth: v.pipe(
        v.string(),
        v.regex(/^[A-Za-z0-9_-]{22}$/),
        v.check((value) => Buffer.from(value, 'base64url').toString('base64url') === value),
      ),
      expirationTime: v.optional(
        v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(8640000000000000))),
        null,
      ),
      applicationServerKey: publicKeySchema,
    }),
  }),
]);
export type EndpointInput = v.InferOutput<typeof endpointInputSchema>;
export const endpointPathSchema = v.strictObject({
  ...recipientPathSchema.entries,
  endpointId: v.pipe(v.string(), v.uuid()),
});
export const endpointDisableSchema = v.strictObject({
  generation: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2147483647)),
});

/**
 * Confirms an installation and creates a new encrypted generation, even for the same target.
 * @param transaction - Authorized endpoint:write transaction holding the environment update lock.
 * @param scope - Owning environment.
 * @param recipientId - Active recipient UUID supplied by a trusted backend.
 * @param keyring - Operator encryption keyring.
 * @param policy - Operator egress policy, never tenant input.
 * @param input - Registration validated with endpointInputSchema.
 * @returns Redacted metadata, or a stable missing-resource, binding, or destination failure.
 * @throws {Error} Database, keyring, DNS, or encryption failures roll back registration.
 * @example
 * ```ts
 * const result = await registerEndpoint(transaction, scope, recipientId, keyring, policy, input);
 * ```
 */
export async function registerEndpoint(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  recipientId: string,
  keyring: SecretKeyring,
  policy: EgressPolicy,
  input: EndpointInput,
): Promise<ResourceResult<EndpointMetadata>> {
  if (!(await lockEndpointRecipient(transaction, scope, recipientId))) {
    return { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
  }
  const credential = await readCredential(transaction, scope, input.credentialId);
  if (!credential) {
    return { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
  }
  if (
    credential.state !== 'active' ||
    credential.provider !== input.provider ||
    credential.appId !== input.appId
  ) {
    return { ok: false, status: 409, code: 'ENDPOINT_BINDING_INVALID' };
  }
  const secret = v.parse(
    credentialInputSchema,
    JSON.parse(
      decryptSecret(
        keyring,
        {
          ...scope,
          resourceId: credential.id,
          purpose: 'credential',
          binding: JSON.stringify([credential.provider, credential.appId, credential.publicKey]),
        },
        credential.encryptedSecret,
      ),
    ),
  );
  if (
    (input.provider === 'apns' &&
      (secret.provider !== 'apns' || input.target.environment !== secret.secret.environment)) ||
    (input.provider === 'fcm' && secret.provider !== 'fcm') ||
    (input.provider === 'web-push' && input.target.applicationServerKey !== credential.publicKey)
  ) {
    return { ok: false, status: 409, code: 'ENDPOINT_BINDING_INVALID' };
  }
  if (input.provider === 'web-push') {
    try {
      await validateDestination(input.target.endpoint, policy);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('EGRESS_DESTINATION_INVALID:')) {
        return { ok: false, status: 422, code: 'EGRESS_DESTINATION_INVALID' };
      }
      if (error instanceof Error && error.message.startsWith('EGRESS_DESTINATION_BLOCKED:')) {
        return { ok: false, status: 422, code: 'EGRESS_DESTINATION_BLOCKED' };
      }
      throw error;
    }
  }
  const previous = await readEndpointInstallation(
    transaction,
    scope,
    input.provider,
    input.appId,
    input.installationId,
  );
  if (previous && previous.recipientId !== recipientId) {
    return { ok: false, status: 409, code: 'ENDPOINT_INSTALLATION_CONFLICT' };
  }
  if (previous?.generation === 2147483647) {
    return { ok: false, status: 409, code: 'ENDPOINT_GENERATION_STALE' };
  }
  const id = previous?.id ?? randomUUID();
  const generation = (previous?.generation ?? 0) + 1;
  const targetIdentity =
    input.provider === 'apns'
      ? [input.target.environment, input.target.token]
      : input.provider === 'fcm'
        ? [input.target.kind, input.target.value]
        : [new URL(input.target.endpoint).href];
  const targetHash = createHash('sha256').update(JSON.stringify(targetIdentity)).digest('hex');
  const registeredAt = new Date();
  const encryptedTarget = encryptSecret(
    keyring,
    {
      ...scope,
      resourceId: id,
      purpose: 'endpoint',
      binding: JSON.stringify([
        recipientId,
        input.provider,
        input.appId,
        input.installationId,
        generation,
        input.credentialId,
      ]),
    },
    JSON.stringify(input.target),
  );
  const ownership = {
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    environmentId: scope.environmentId,
  };
  const record = await persistEndpointRegistration(
    transaction,
    {
      ...ownership,
      id,
      recipientId,
      installationId: input.installationId,
      provider: input.provider,
      appId: input.appId,
      generation,
      credentialId: input.credentialId,
      targetHash,
      registeredAt,
    },
    {
      ...ownership,
      endpointId: id,
      generation,
      credentialId: input.credentialId,
      encryptedTarget,
      registeredAt,
    },
  );
  return { ok: true, value: record };
}

/**
 * Lists redacted metadata using a cursor bound to this recipient and environment.
 * @param transaction - Authorized endpoint:read transaction.
 * @param scope - Owning environment.
 * @param recipientId - Active recipient UUID.
 * @param limit - Validated page size from 1 to 100.
 * @param cursor - Previous nextCursor, or undefined for the first page.
 * @returns A metadata page, RESOURCE_NOT_FOUND, or RESOURCE_CURSOR_INVALID.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await listEndpoints(transaction, scope, recipientId, 20, undefined);
 * ```
 */
export async function listEndpoints(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  recipientId: string,
  limit: number,
  cursor: string | undefined,
): Promise<ResourceResult<ResourcePage<EndpointMetadata>>> {
  const collection = { ...scope, collection: 'endpoints', recipientId } as const;
  const afterId = readResourceCursor(collection, cursor);
  if (afterId === false) {
    return { ok: false, status: 422, code: 'RESOURCE_CURSOR_INVALID' };
  }
  if (!(await readRecipient(transaction, scope, recipientId))) {
    return { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
  }
  const records = await listEndpointMetadata(transaction, scope, recipientId, limit + 1, afterId);
  return { ok: true, value: resourcePage(collection, records, limit) };
}

/**
 * Reads metadata without exposing provider identifiers, subscription keys, or target hashes.
 * @param transaction - Authorized endpoint:read transaction.
 * @param scope - Owning environment.
 * @param recipientId - Active recipient UUID.
 * @param id - Endpoint UUID.
 * @returns Metadata, or RESOURCE_NOT_FOUND.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await readEndpoint(transaction, scope, recipientId, id);
 * ```
 */
export async function readEndpoint(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  recipientId: string,
  id: string,
): Promise<ResourceResult<EndpointMetadata>> {
  if (!(await readRecipient(transaction, scope, recipientId))) {
    return { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
  }
  const record = await readEndpointMetadata(transaction, scope, recipientId, id);
  return record
    ? { ok: true, value: record }
    : { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
}

/**
 * Disables a generation without letting a stale request disable a refreshed installation.
 * @param transaction - Authorized endpoint:write transaction holding the environment update lock.
 * @param scope - Owning environment.
 * @param recipientId - Active recipient UUID.
 * @param id - Endpoint UUID.
 * @param generation - Validated generation from the metadata or provider attempt.
 * @param invalidatedAt - APNs provider timestamp, or undefined for manual/other-provider disable.
 * @returns Disabled metadata, RESOURCE_NOT_FOUND, or ENDPOINT_GENERATION_STALE.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await disableEndpoint(transaction, scope, recipientId, id, 2, undefined);
 * ```
 */
export async function disableEndpoint(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  recipientId: string,
  id: string,
  generation: number,
  invalidatedAt: Date | undefined,
): Promise<ResourceResult<EndpointMetadata>> {
  if (!(await lockEndpointRecipient(transaction, scope, recipientId))) {
    return { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
  }
  const existing = await readEndpointMetadata(transaction, scope, recipientId, id);
  if (!existing) {
    return { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
  }
  const record = await disableEndpointGeneration(
    transaction,
    scope,
    recipientId,
    id,
    generation,
    invalidatedAt,
  );
  return record
    ? { ok: true, value: record }
    : { ok: false, status: 409, code: 'ENDPOINT_GENERATION_STALE' };
}
