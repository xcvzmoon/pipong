import type { SecretContext, SecretKeyring } from '@pipong/service';
import { decryptSecret, encryptSecret, loadSecretKeyring } from '@pipong/service';
import { createSecretKey } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

const keyring: SecretKeyring = {
  activeKeyId: 'first',
  keys: new Map([['first', createSecretKey(Buffer.alloc(32, 1))]]),
};
const context: SecretContext = {
  organizationId: 'organization',
  projectId: 'project',
  environmentId: 'environment',
  resourceId: 'resource',
  purpose: 'credential',
  binding: 'web-push:application',
};

describe('tenant-bound secret encryption', () => {
  it('authenticates every context field and uses fresh nonces for the same secret', () => {
    const encrypted = encryptSecret(keyring, context, 'private-secret');
    expect(encrypted).not.toContain('private-secret');
    expect(encryptSecret(keyring, context, 'private-secret')).not.toBe(encrypted);
    expect(decryptSecret(keyring, context, encrypted)).toBe('private-secret');

    for (const field of [
      'organizationId',
      'projectId',
      'environmentId',
      'resourceId',
      'binding',
    ] as const) {
      expect(() => decryptSecret(keyring, { ...context, [field]: 'other' }, encrypted)).toThrow(
        'CREDENTIAL_DECRYPT_FAILED',
      );
    }

    expect(() => decryptSecret(keyring, { ...context, purpose: 'endpoint' }, encrypted)).toThrow(
      'CREDENTIAL_DECRYPT_FAILED',
    );
  });

  it('rejects tampered ciphertext, tags, nonces, malformed envelopes, and missing keys', () => {
    const encrypted = encryptSecret(keyring, context, 'private-secret');
    const envelope = v.parse(
      v.object({
        keyId: v.string(),
        nonce: v.string(),
        tag: v.string(),
        ciphertext: v.string(),
        version: v.number(),
      }),
      JSON.parse(encrypted),
    );

    for (const field of ['ciphertext', 'tag', 'nonce'] as const) {
      const original = envelope[field];
      const changed = (original.startsWith('0') ? '1' : '0') + original.slice(1);
      expect(() =>
        decryptSecret(keyring, context, JSON.stringify({ ...envelope, [field]: changed })),
      ).toThrow('CREDENTIAL_DECRYPT_FAILED');
    }

    expect(() =>
      decryptSecret(keyring, context, JSON.stringify({ ...envelope, tag: envelope.tag.slice(2) })),
    ).toThrow('CREDENTIAL_DECRYPT_FAILED');
    expect(() => decryptSecret(keyring, context, '{}')).toThrow('CREDENTIAL_DECRYPT_FAILED');
    expect(() =>
      decryptSecret({ activeKeyId: 'missing', keys: new Map() }, context, encrypted),
    ).toThrow('CREDENTIAL_KEY_UNAVAILABLE');
    expect(() =>
      encryptSecret({ activeKeyId: 'missing', keys: new Map() }, context, 'secret'),
    ).toThrow('CREDENTIAL_KEY_UNAVAILABLE');
  });

  it('reloads the operator keyring, rotates keys, and never reuses removed keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipong-keyring-'));
    const path = join(directory, 'keys.json');

    try {
      await writeFile(
        path,
        JSON.stringify({ activeKeyId: 'first', keys: { first: '01'.repeat(32) } }),
      );
      const encrypted = encryptSecret(await loadSecretKeyring(path), context, 'secret');
      await writeFile(
        path,
        JSON.stringify({
          activeKeyId: 'second',
          keys: { first: '01'.repeat(32), second: '02'.repeat(32) },
        }),
      );
      const rotatedKeyring = await loadSecretKeyring(path);
      const rotated = encryptSecret(
        rotatedKeyring,
        context,
        decryptSecret(rotatedKeyring, context, encrypted),
      );
      await writeFile(
        path,
        JSON.stringify({ activeKeyId: 'second', keys: { second: '02'.repeat(32) } }),
      );
      const finalKeyring = await loadSecretKeyring(path);
      expect(decryptSecret(finalKeyring, context, rotated)).toBe('secret');
      expect(() => decryptSecret(finalKeyring, context, encrypted)).toThrow(
        'CREDENTIAL_KEY_UNAVAILABLE',
      );
      await writeFile(path, '{"activeKeyId":"secret-value","keys":{}}');
      await expect(loadSecretKeyring(path)).rejects.toThrow('CREDENTIAL_KEYRING_INVALID');
      await expect(loadSecretKeyring('vault://unsupported')).rejects.toThrow(
        'CREDENTIAL_KEYRING_INVALID',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
