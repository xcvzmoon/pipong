import type { EnvironmentScope, RecipientRecord } from '@pipong/database/recipients';
import type { TenantTransaction } from '@pipong/database/tenancy';
import type { ResourcePage, ResourceResult } from './resources.ts';
import {
  upsertRecipient as persistRecipient,
  listRecipients as selectRecipients,
  readRecipient as selectRecipient,
  deleteRecipient as markRecipientDeleted,
} from '@pipong/database/recipients';
import * as v from 'valibot';
import { environmentPathSchema, readResourceCursor, resourcePage } from './resources.ts';

export const recipientInputSchema = v.strictObject({
  externalId: v.pipe(
    v.string(),
    // oxlint-disable-next-line eslint/no-control-regex -- External identities must exclude control characters.
    v.regex(/^[^\uD800-\uDFFF\u0000-\u001F\u007F-\u009F]{1,200}$/u),
    v.regex(/\S/u),
  ),
});
export const recipientPathSchema = v.strictObject({
  ...environmentPathSchema.entries,
  recipientId: v.pipe(v.string(), v.uuid()),
});

/**
 * Upserts a case-sensitive application identity within an environment.
 * @param transaction - Active transaction after recipient:write authorization.
 * @param scope - Owning environment.
 * @param externalId - Identity validated with recipientInputSchema; whitespace is preserved.
 * @returns The active recipient, or RECIPIENT_DELETED if this identity was deleted.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await upsertRecipient(transaction, scope, 'customer-42')
 * if (result.ok) console.info(result.value.id)
 * ```
 */
export async function upsertRecipient(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  externalId: string,
): Promise<ResourceResult<RecipientRecord>> {
  const record = await persistRecipient(transaction, scope, externalId);
  return record
    ? { ok: true, value: record }
    : { ok: false, status: 409, code: 'RECIPIENT_DELETED' };
}

/**
 * Lists active recipients with a cursor bound to their environment.
 * @param transaction - Active transaction after recipient:read authorization.
 * @param scope - Owning environment.
 * @param limit - Validated page size from 1 to 100.
 * @param cursor - Previous nextCursor, or undefined for the first page.
 * @returns A page, or RESOURCE_CURSOR_INVALID for a malformed or mismatched cursor.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await listRecipients(transaction, scope, 20, undefined)
 * if (result.ok) console.info(result.value.items)
 * ```
 */
export async function listRecipients(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  limit: number,
  cursor: string | undefined,
): Promise<ResourceResult<ResourcePage<RecipientRecord>>> {
  const afterId = readResourceCursor({ ...scope, collection: 'recipients' }, cursor);
  if (afterId === false) return { ok: false, status: 422, code: 'RESOURCE_CURSOR_INVALID' };
  const records = await selectRecipients(transaction, scope, limit + 1, afterId);
  return { ok: true, value: resourcePage({ ...scope, collection: 'recipients' }, records, limit) };
}

/**
 * Reads an active recipient in its owning environment.
 * @param transaction - Active transaction after recipient:read authorization.
 * @param scope - Owning environment.
 * @param id - Validated recipient UUID.
 * @returns The record, or RESOURCE_NOT_FOUND for a missing, deleted, or out-of-scope ID.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await readRecipient(transaction, scope, id)
 * if (result.ok) console.info(result.value.externalId)
 * ```
 */
export async function readRecipient(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  id: string,
): Promise<ResourceResult<RecipientRecord>> {
  const record = await selectRecipient(transaction, scope, id);
  return record
    ? { ok: true, value: record }
    : { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
}

/**
 * Deletes one recipient while reserving its external identity against resurrection.
 * @param transaction - Active transaction after recipient:write authorization.
 * @param scope - Owning environment.
 * @param id - Validated recipient UUID.
 * @returns The tombstone, or RESOURCE_NOT_FOUND for a missing, deleted, or out-of-scope ID.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await deleteRecipient(transaction, scope, id)
 * if (!result.ok) console.warn(result.code)
 * ```
 */
export async function deleteRecipient(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  id: string,
): Promise<ResourceResult<RecipientRecord>> {
  const record = await markRecipientDeleted(transaction, scope, id);
  return record
    ? { ok: true, value: record }
    : { ok: false, status: 404, code: 'RESOURCE_NOT_FOUND' };
}
