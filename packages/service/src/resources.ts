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
export const resourceInputSchema = v.strictObject({ name: resourceNameSchema });
export const projectPathSchema = v.strictObject({ organizationId: idSchema, projectId: idSchema });
export const organizationPathSchema = v.pick(projectPathSchema, ['organizationId']);
export const environmentPathSchema = v.strictObject({
  organizationId: idSchema,
  projectId: idSchema,
  environmentId: idSchema,
});
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
]);

type CollectionScope = Extract<TenantScope, { kind: 'organization' | 'project' }>;
export type ResourceFailure = {
  ok: false;
  status: 404 | 409 | 422;
  code:
    | 'RESOURCE_NOT_FOUND'
    | 'RESOURCE_NAME_CONFLICT'
    | 'RESOURCE_CURSOR_INVALID'
    | 'RESOURCE_SUSPENDED'
    | 'RESOURCE_DELETION_GATED';
};
export type ResourceResult<Value> = { ok: true; value: Value } | ResourceFailure;
export type ResourcePage<Record> = { items: Record[]; nextCursor: string | null };

export function readResourceCursor(
  scope: CollectionScope,
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
      scope.kind === 'project' &&
      (parsed.output.kind !== 'project' || parsed.output.projectId !== scope.projectId)
    ) {
      return false;
    }

    return parsed.output.afterId;
  } catch {
    return false;
  }
}

export function resourcePage<Record extends { id: string }>(
  scope: CollectionScope,
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
