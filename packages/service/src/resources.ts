import type { TenantScope } from '@pipong/database/tenancy';
import * as v from 'valibot';

const idSchema = v.pipe(v.string(), v.uuid());
export const resourceNameSchema = v.pipe(
  v.string(),
  v.regex(/^[^\uD800-\uDFFF]{1,100}$/u),
  v.excludes('\0'),
  v.regex(/\S/u),
  v.trim(),
);
/**
 * Validates a resource body with exactly one name field.
 *
 * Names must contain 1 to 100 Unicode characters before trimming, include a
 * non-whitespace character, and contain neither NUL nor unpaired surrogates.
 *
 * @example
 * ```ts
 * const input = v.parse(resourceInputSchema, { name: ' Production ' });
 * console.info(input.name);
 * ```
 */
export const resourceInputSchema = v.strictObject({ name: resourceNameSchema });
/**
 * Validates organization and project UUIDs from route parameters.
 */
export const projectPathSchema = v.strictObject({ organizationId: idSchema, projectId: idSchema });
/**
 * Validates the organization UUID for a project collection route.
 */
export const organizationPathSchema = v.pick(projectPathSchema, ['organizationId']);
/**
 * Validates organization, project, and environment UUIDs from route parameters.
 */
export const environmentPathSchema = v.strictObject({
  organizationId: idSchema,
  projectId: idSchema,
  environmentId: idSchema,
});
/**
 * Parses collection query strings into a page size and optional cursor.
 *
 * The page size defaults to 50 and must be a decimal integer from 1 to 100.
 * Cursor syntax is checked here; collection binding is checked by the service.
 *
 * @example
 * ```ts
 * const query = v.parse(resourcePageSchema, { limit: '20' });
 * const result = await listProjects(transaction, scope, query.limit, query.cursor);
 * ```
 */
export const resourcePageSchema = v.strictObject({
  limit: v.optional(
    v.pipe(
      v.string(),
      v.regex(/^[1-9]\d{0,2}$/),
      v.toNumber(),
      v.integer(),
      v.minValue(1),
      v.maxValue(100),
    ),
    '50',
  ),
  cursor: v.optional(
    v.pipe(v.string(), v.minLength(1), v.maxLength(1024), v.regex(/^[A-Za-z0-9_-]+$/)),
  ),
});

type ResourceScope = TenantScope & { collection?: 'recipients' };

const cursorSchema = v.variant('kind', [
  v.strictObject({
    version: v.literal(1),
    kind: v.literal('organization'),
    organizationId: idSchema,
    afterId: idSchema,
  }),
  v.strictObject({
    version: v.literal(1),
    kind: v.literal('project'),
    organizationId: idSchema,
    projectId: idSchema,
    afterId: idSchema,
  }),
  v.strictObject({
    version: v.literal(1),
    kind: v.literal('environment'),
    collection: v.optional(v.literal('recipients')),
    organizationId: idSchema,
    projectId: idSchema,
    environmentId: idSchema,
    afterId: idSchema,
  }),
]);

/**
 * Expected resource failure with an HTTP status and stable application code.
 */
export type ResourceFailure = {
  ok: false;
  status: 404 | 409 | 422;
  code:
    | 'RESOURCE_NOT_FOUND'
    | 'RESOURCE_NAME_CONFLICT'
    | 'RESOURCE_CURSOR_INVALID'
    | 'RESOURCE_SUSPENDED'
    | 'RESOURCE_DELETION_GATED'
    | 'RECIPIENT_DELETED';
};
/**
 * Resource result; check ok before reading the value or failure code.
 */
export type ResourceResult<Value> = { ok: true; value: Value } | ResourceFailure;
/**
 * Collection page whose nextCursor is null when no further page was detected.
 */
export type ResourcePage<Record> = { items: Record[]; nextCursor: string | null };

/**
 * Decodes a canonical base64url cursor and verifies its collection scope.
 *
 * @param scope - Collection whose tenant IDs and optional recipient collection discriminator must match the cursor.
 * @param cursor - Cursor returned by resourcePage, or undefined for the first page.
 * @returns The exclusive record ID, undefined when no cursor is supplied, or false when decoding or scope validation fails.
 *
 * @example
 * ```ts
 * const afterId = readResourceCursor(scope, cursor);
 * if (afterId === false) {
 *   console.warn('RESOURCE_CURSOR_INVALID');
 * }
 * ```
 */
export function readResourceCursor(
  scope: ResourceScope,
  cursor: string | undefined,
): string | undefined | false {
  if (cursor === undefined) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(cursor, 'base64url');

    if (decoded.toString('base64url') !== cursor) {
      return false;
    }

    const parsed = v.safeParse(cursorSchema, JSON.parse(decoded.toString('utf8')));

    if (
      !parsed.success ||
      parsed.output.kind !== scope.kind ||
      parsed.output.organizationId !== scope.organizationId
    ) {
      return false;
    }

    if (
      scope.kind !== 'organization' &&
      (parsed.output.kind === 'organization' || parsed.output.projectId !== scope.projectId)
    ) {
      return false;
    }

    if (
      scope.kind === 'environment' &&
      (parsed.output.kind !== 'environment' ||
        parsed.output.environmentId !== scope.environmentId ||
        parsed.output.collection !== scope.collection)
    ) {
      return false;
    }

    return parsed.output.afterId;
  } catch {
    return false;
  }
}

/**
 * Builds a page and encodes the last included ID when more records are available.
 *
 * @param scope - Owning tenant scope and optional recipient collection discriminator to bind into the cursor.
 * @param records - Records in ascending ID order; fetch limit + 1 to detect another page.
 * @param limit - Validated maximum number of items to include.
 * @returns At most limit items and a cursor, or null when no extra record was fetched.
 *
 * @example
 * ```ts
 * const page = resourcePage(scope, records, 20);
 * console.info(page.items, page.nextCursor);
 * ```
 */
export function resourcePage<Record extends { id: string }>(
  scope: ResourceScope,
  records: Record[],
  limit: number,
): ResourcePage<Record> {
  const items = records.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    records.length > limit && last
      ? Buffer.from(JSON.stringify({ version: 1, ...scope, afterId: last.id })).toString(
          'base64url',
        )
      : null;

  return { items, nextCursor };
}
