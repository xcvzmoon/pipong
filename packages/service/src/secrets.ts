import type { KeyObject } from 'node:crypto';
import { createCipheriv, createDecipheriv, createSecretKey, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as v from 'valibot';

const keyIdSchema = v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{1,64}$/));
const keyringSchema = v.strictObject({
  activeKeyId: keyIdSchema,
  keys: v.pipe(
    v.record(keyIdSchema, v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))),
    v.minEntries(1),
    v.maxEntries(32),
  ),
});
const encryptedValueSchema = v.strictObject({
  version: v.literal(1),
  keyId: keyIdSchema,
  nonce: v.pipe(v.string(), v.regex(/^[a-f0-9]{24}$/)),
  tag: v.pipe(v.string(), v.regex(/^[a-f0-9]{32}$/)),
  ciphertext: v.pipe(v.string(), v.regex(/^(?:[a-f0-9]{2}){1,65536}$/)),
});

export type SecretKeyring = { activeKeyId: string; keys: ReadonlyMap<string, KeyObject> };
export type EncryptedValue = v.InferOutput<typeof encryptedValueSchema>;
export type SecretContext = {
  organizationId: string;
  projectId: string;
  environmentId: string;
  resourceId: string;
  purpose: 'credential' | 'endpoint';
  binding: string;
};

/**
 * Reads an operator-owned JSON keyring without caching keys or plaintext.
 * @param reference - Absolute file path from CREDENTIAL_KEYRING_REF.
 * @returns Validated AES-256 keys and the key used for new encryption.
 * @throws {Error} CREDENTIAL_KEYRING_INVALID if the file or active key is invalid. Values are omitted from errors.
 * @example
 * ```ts
 * const keyring = await loadSecretKeyring('/run/secrets/credential-keyring.json');
 * ```
 */
export async function loadSecretKeyring(reference: string): Promise<SecretKeyring> {
  try {
    if (!reference.startsWith('/')) {
      throw new Error('Invalid path');
    }

    const content = await readFile(reference, 'utf8');

    if (Buffer.byteLength(content) > 8192) {
      throw new Error('Invalid size');
    }

    const parsed = v.parse(keyringSchema, JSON.parse(content));
    const keys = new Map<string, KeyObject>();

    for (const [id, hex] of Object.entries(parsed.keys)) {
      keys.set(id, createSecretKey(Buffer.from(hex, 'hex')));
    }

    if (!keys.has(parsed.activeKeyId)) {
      throw new Error('Missing active key');
    }

    return { activeKeyId: parsed.activeKeyId, keys };
  } catch {
    throw new Error('CREDENTIAL_KEYRING_INVALID: cannot load credential keyring');
  }
}

function authenticatedContext(context: SecretContext, keyId: string): Buffer {
  return Buffer.from(
    JSON.stringify([
      'pipong',
      1,
      keyId,
      context.organizationId,
      context.projectId,
      context.environmentId,
      context.resourceId,
      context.purpose,
      context.binding,
    ]),
  );
}

/**
 * Encrypts a secret with a fresh nonce and authenticated ownership and binding.
 * @param keyring - Operator keyring; the active key must be available.
 * @param context - Immutable tenant, resource, purpose, and provider binding.
 * @param plaintext - UTF-8 secret, between 1 and 65536 bytes.
 * @returns Serialized AES-256-GCM envelope, suitable for storage.
 * @throws {Error} CREDENTIAL_KEY_UNAVAILABLE or CREDENTIAL_SECRET_INVALID for missing keys or invalid size.
 * @example
 * ```ts
 * const encrypted = encryptSecret(keyring, context, JSON.stringify(input));
 * ```
 */
export function encryptSecret(
  keyring: SecretKeyring,
  context: SecretContext,
  plaintext: string,
): string {
  const key = keyring.keys.get(keyring.activeKeyId);

  if (!key) {
    throw new Error('CREDENTIAL_KEY_UNAVAILABLE: encryption key is unavailable');
  }

  if (Buffer.byteLength(plaintext) < 1 || Buffer.byteLength(plaintext) > 65536) {
    throw new Error('CREDENTIAL_SECRET_INVALID: secret size is invalid');
  }

  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(authenticatedContext(context, keyring.activeKeyId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return JSON.stringify({
    version: 1,
    keyId: keyring.activeKeyId,
    nonce: nonce.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  } satisfies EncryptedValue);
}

/**
 * Authenticates the whole envelope before returning plaintext. Nothing is cached.
 * @param keyring - Keyring containing the envelope's key version.
 * @param context - Expected immutable ownership and binding.
 * @param encrypted - Stored JSON envelope.
 * @returns Authenticated UTF-8 plaintext for internal provider use only.
 * @throws {Error} CREDENTIAL_KEY_UNAVAILABLE or CREDENTIAL_DECRYPT_FAILED. No partial plaintext is returned.
 * @example
 * ```ts
 * const plaintext = decryptSecret(keyring, context, encrypted);
 * ```
 */
export function decryptSecret(
  keyring: SecretKeyring,
  context: SecretContext,
  encrypted: string,
): string {
  let envelope: EncryptedValue;

  try {
    envelope = v.parse(encryptedValueSchema, JSON.parse(encrypted));
  } catch {
    throw new Error('CREDENTIAL_DECRYPT_FAILED: invalid encrypted value');
  }

  const key = keyring.keys.get(envelope.keyId);

  if (!key) {
    throw new Error('CREDENTIAL_KEY_UNAVAILABLE: decryption key is unavailable');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'hex'), {
      authTagLength: 16,
    });
    decipher.setAAD(authenticatedContext(context, envelope.keyId));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('CREDENTIAL_DECRYPT_FAILED: encrypted value authentication failed');
  }
}
