import type { CredentialMetadata, CredentialRecord } from '@pipong/database/credentials';
import type { EnvironmentScope } from '@pipong/database/recipients';
import type { TenantTransaction } from '@pipong/database/tenancy';
import type { ResourcePage, ResourceResult } from './resources.ts';
import type { SecretContext, SecretKeyring } from './secrets.ts';
import {
  changeCredentialState,
  insertCredential,
  listCredentialMetadata,
  lockCredentialEnvironment,
  readCredential,
  readCredentialMetadata,
  replaceCredentialEnvelope,
} from '@pipong/database/credentials';
import { createECDH, createPrivateKey, randomUUID } from 'node:crypto';
import * as v from 'valibot';
import { environmentPathSchema, readResourceCursor, resourcePage } from './resources.ts';
import { decryptSecret, encryptSecret } from './secrets.ts';

const identifierSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9._-]{1,200}$/));
const pemSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(16384));
const p256PrivateKeySchema = v.pipe(
  pemSchema,
  v.check((value) => {
    try {
      const key = createPrivateKey(value);
      return (
        key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
      );
    } catch {
      return false;
    }
  }, 'Must be a P-256 private key'),
);
const rsaPrivateKeySchema = v.pipe(
  pemSchema,
  v.check((value) => {
    try {
      const key = createPrivateKey(value);
      return (
        key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048
      );
    } catch {
      return false;
    }
  }, 'Must be an RSA private key of at least 2048 bits'),
);
const vapidPrivateKeySchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{43}$/),
  v.check((value) => {
    try {
      const bytes = Buffer.from(value, 'base64url');
      const key = createECDH('prime256v1');
      key.setPrivateKey(bytes);
      return bytes.toString('base64url') === value;
    } catch {
      return false;
    }
  }, 'Must be a valid base64url P-256 private scalar'),
);

/**
 * Validates typed provider secrets once at the HTTP or operator boundary.
 * @example
 * ```ts
 * const input = v.parse(credentialInputSchema, requestBody);
 * ```
 */
export const credentialInputSchema = v.variant('provider', [
  v.strictObject({
    provider: v.literal('apns'),
    appId: identifierSchema,
    secret: v.strictObject({
      teamId: v.pipe(v.string(), v.regex(/^[A-Z0-9]{10}$/)),
      keyId: v.pipe(v.string(), v.regex(/^[A-Z0-9]{10}$/)),
      environment: v.picklist(['production', 'sandbox']),
      privateKey: p256PrivateKeySchema,
    }),
  }),
  v.strictObject({
    provider: v.literal('fcm'),
    appId: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/)),
    secret: v.strictObject({
      projectId: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/)),
      clientEmail: v.pipe(v.string(), v.email(), v.maxLength(254)),
      privateKey: rsaPrivateKeySchema,
    }),
  }),
  v.strictObject({
    provider: v.literal('web-push'),
    appId: identifierSchema,
    secret: v.strictObject({ privateKey: vapidPrivateKeySchema }),
  }),
]);
export type CredentialInput = v.InferOutput<typeof credentialInputSchema>;
export const credentialPathSchema = v.strictObject({
  ...environmentPathSchema.entries,
  credentialId: v.pipe(v.string(), v.uuid()),
});

function credentialContext(
  scope: EnvironmentScope,
  id: string,
  provider: CredentialInput['provider'],
  appId: string,
  publicKey: string | null,
): SecretContext {
  return {
    ...scope,
    resourceId: id,
    purpose: 'credential',
    binding: JSON.stringify([provider, appId, publicKey]),
  };
}

function metadata(record: CredentialRecord): CredentialMetadata {
  const { encryptedSecret: _encryptedSecret, ...publicMetadata } = record;
  return publicMetadata;
}

/**
 * Creates an inactive immutable credential version. Secrets are never returned.
 * @param transaction - Authorized credential:manage transaction with recent MFA.
 * @param scope - Owning environment.
 * @param keyring - Current operator keyring.
 * @param input - Provider input validated by credentialInputSchema.
 * @returns Public metadata of the new inactive version.
 * @throws {Error} Encryption and database failures propagate with no secrets in application errors.
 * @example
 * ```ts
 * const result = await createCredentialVersion(transaction, scope, keyring, input);
 * ```
 */
export async function createCredentialVersion(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  keyring: SecretKeyring,
  input: CredentialInput,
): Promise<ResourceResult<CredentialMetadata>> {
  const id = randomUUID();
  let publicKey: string | null = null;

  if (input.provider === 'web-push') {
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(input.secret.privateKey, 'base64url'));
    publicKey = key.getPublicKey().toString('base64url');
  }

  const encryptedSecret = encryptSecret(
    keyring,
    credentialContext(scope, id, input.provider, input.appId, publicKey),
    JSON.stringify(input),
  );
  const record = await insertCredential(transaction, {
    id,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    environmentId: scope.environmentId,
    provider: input.provider,
    appId: input.appId,
    publicKey,
    encryptedSecret,
  });

  return { ok: true, value: record };
}

/**
 * Lists immutable credential versions with a collection-bound cursor.
 * @param transaction - Authorized credential:read transaction.
 * @param scope - Owning environment.
 * @param limit - Validated page size from 1 to 100.
 * @param cursor - Previous nextCursor, or undefined for the first page.
 * @returns Metadata page, or RESOURCE_CURSOR_INVALID.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await listCredentialVersions(transaction, scope, 20, undefined);
 * ```
 */
export async function listCredentialVersions(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  limit: number,
  cursor: string | undefined,
): Promise<ResourceResult<ResourcePage<CredentialMetadata>>> {
  const afterId = readResourceCursor({ ...scope, collection: 'credentials' }, cursor);

  if (afterId === false) {
    return { ok: false, status: 422, code: 'RESOURCE_CURSOR_INVALID' };
  }

  const records = await listCredentialMetadata(transaction, scope, limit + 1, afterId);
  return { ok: true, value: resourcePage({ ...scope, collection: 'credentials' }, records, limit) };
}

/**
 * Reads credential metadata, including the VAPID public key for Web Push.
 * @param transaction - Authorized credential:read transaction.
 * @param scope - Owning environment.
 * @param id - Validated version UUID.
 * @returns Metadata, or RESOURCE_NOT_FOUND for absent or out-of-scope versions.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await readCredentialVersion(transaction, scope, id);
 * ```
 */
export async function readCredentialVersion(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  id: string,
): Promise<ResourceResult<CredentialMetadata>> {
  const record = await readCredentialMetadata(transaction, scope, id);
  return record
    ? { ok: true, value: record }
    : { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
}

/**
 * Authenticates a version before activating it, serializing concurrent changes.
 * The former active version remains inactive for pinned deliveries. Retired versions cannot reactivate.
 * @param transaction - Authorized credential:manage transaction with recent MFA.
 * @param scope - Owning environment.
 * @param keyring - Current operator keyring.
 * @param id - Validated version UUID.
 * @returns Active metadata, RESOURCE_NOT_FOUND, or CREDENTIAL_RETIRED.
 * @throws {Error} Missing keys, failed authentication, or database failures roll back activation.
 * @example
 * ```ts
 * const result = await activateCredentialVersion(transaction, scope, keyring, id);
 * ```
 */
export async function activateCredentialVersion(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  keyring: SecretKeyring,
  id: string,
): Promise<ResourceResult<CredentialMetadata>> {
  await lockCredentialEnvironment(transaction, scope);
  const record = await readCredential(transaction, scope, id);

  if (!record) {
    return { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
  }

  if (record.state === 'retired') {
    return { ok: false, status: 409, code: 'CREDENTIAL_RETIRED' };
  }

  decryptSecret(
    keyring,
    credentialContext(scope, id, record.provider, record.appId, record.publicKey),
    record.encryptedSecret,
  );
  return { ok: true, value: await changeCredentialState(transaction, record, 'active') };
}

/**
 * Retires a version permanently. Future delivery admission must reject retired versions.
 * @param transaction - Authorized credential:manage transaction with recent MFA.
 * @param scope - Owning environment.
 * @param id - Validated version UUID.
 * @returns Retired metadata, or RESOURCE_NOT_FOUND. Repeated retirement preserves its timestamp.
 * @throws {Error} Database failures propagate. Pending-delivery checks are required before delivery consumers ship.
 * @example
 * ```ts
 * const result = await retireCredentialVersion(transaction, scope, id);
 * ```
 */
export async function retireCredentialVersion(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  id: string,
): Promise<ResourceResult<CredentialMetadata>> {
  await lockCredentialEnvironment(transaction, scope);
  const record = await readCredential(transaction, scope, id);

  if (!record) {
    return { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
  }

  if (record.state === 'retired') {
    return { ok: true, value: metadata(record) };
  }

  return { ok: true, value: await changeCredentialState(transaction, record, 'retired') };
}

/**
 * Reencrypts one credential with the keyring's active key without changing its version or lifecycle.
 * @param transaction - Authorized credential:manage or operator tenant transaction.
 * @param scope - Owning environment.
 * @param keyring - Keyring retaining the old key and containing the new active key.
 * @param id - Validated version UUID.
 * @returns Metadata, or RESOURCE_NOT_FOUND. Plaintext never leaves this operation.
 * @throws {Error} Missing keys, authentication failures, and database failures roll back the replacement.
 * @example
 * ```ts
 * const result = await rotateCredentialEncryption(transaction, scope, keyring, id);
 * ```
 */
export async function rotateCredentialEncryption(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  keyring: SecretKeyring,
  id: string,
): Promise<ResourceResult<CredentialMetadata>> {
  const record = await readCredential(transaction, scope, id);

  if (!record) {
    return { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
  }

  const context = credentialContext(scope, id, record.provider, record.appId, record.publicKey);
  const plaintext = decryptSecret(keyring, context, record.encryptedSecret);
  await replaceCredentialEnvelope(transaction, record, encryptSecret(keyring, context, plaintext));

  return { ok: true, value: metadata(record) };
}
