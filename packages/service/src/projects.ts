import type { OrganizationScope, ProjectRecord } from '@pipong/database/projects';
import type { TenantTransaction } from '@pipong/database/tenancy';
import type { ResourcePage, ResourceResult } from './resources.ts';
import {
  createProject as insertProject,
  listProjects as selectProjects,
  readProject as selectProject,
  renameProject,
  suspendProject as markProjectSuspended,
} from '@pipong/database/projects';
import { readResourceCursor, resourcePage } from './resources.ts';

/**
 * Creates a project within an authorized organization.
 *
 * @param transaction - Active tenant transaction after authorization.
 * @param scope - Organization that owns the projects.
 * @param name - Name already validated with resourceInputSchema.
 * @returns The created record, or RESOURCE_NAME_CONFLICT when the name is already reserved.
 * @throws {Error} Database failures propagate to the caller.
 *
 * @example
 * ```ts
 * const result = await createProject(transaction, scope, 'Production');
 * if (result.ok) {
 *   console.info(result.value.id);
 * } else {
 *   console.warn(result.code);
 * }
 * ```
 */
export async function createProject(
  transaction: TenantTransaction,
  scope: OrganizationScope,
  name: string,
): Promise<ResourceResult<ProjectRecord>> {
  const record = await insertProject(transaction, scope, name);

  if (!record) {
    return {
      ok: false,
      status: 409,
      code: 'RESOURCE_NAME_CONFLICT',
    };
  }

  return {
    ok: true,
    value: record,
  };
}

/**
 * Lists undeleted projects in ascending ID order using a scope-bound cursor.
 *
 * @param transaction - Active tenant transaction after authorization.
 * @param scope - Organization that owns the projects.
 * @param limit - Validated page size from 1 to 100.
 * @param cursor - Cursor from the previous page, or undefined for the first page.
 * @returns A page with a nullable next cursor, or RESOURCE_CURSOR_INVALID for a malformed or mismatched cursor.
 * @throws {Error} Database failures propagate to the caller.
 *
 * @example
 * ```ts
 * const result = await listProjects(transaction, scope, 20, undefined);
 * if (result.ok) {
 *   const { items, nextCursor } = result.value;
 *   console.info(items, nextCursor);
 * }
 * ```
 */
export async function listProjects(
  transaction: TenantTransaction,
  scope: OrganizationScope,
  limit: number,
  cursor: string | undefined,
): Promise<ResourceResult<ResourcePage<ProjectRecord>>> {
  const afterId = readResourceCursor(scope, cursor);

  if (afterId === false) {
    return {
      ok: false,
      status: 422,
      code: 'RESOURCE_CURSOR_INVALID',
    };
  }

  const records = await selectProjects(transaction, scope, limit + 1, afterId);

  return {
    ok: true,
    value: resourcePage(scope, records, limit),
  };
}

/**
 * Reads an undeleted project within its owning organization.
 *
 * @param transaction - Active tenant transaction after authorization.
 * @param scope - Organization that owns the projects.
 * @param id - ID of the project within the supplied scope.
 * @returns The record, or RESOURCE_NOT_FOUND when it is missing or deleted.
 * @throws {Error} Database failures propagate to the caller.
 *
 * @example
 * ```ts
 * const result = await readProject(transaction, scope, id);
 * if (result.ok) {
 *   console.info(result.value.id);
 * } else {
 *   console.warn(result.code);
 * }
 * ```
 */
export async function readProject(
  transaction: TenantTransaction,
  scope: OrganizationScope,
  id: string,
): Promise<ResourceResult<ProjectRecord>> {
  const record = await selectProject(transaction, scope, id);

  if (!record) {
    return {
      ok: false,
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    };
  }

  return {
    ok: true,
    value: record,
  };
}

/**
 * Renames an undeleted project within its owning organization.
 *
 * @param transaction - Active tenant transaction after authorization.
 * @param scope - Organization that owns the projects.
 * @param id - ID of the project within the supplied scope.
 * @param name - Name already validated with resourceInputSchema.
 * @returns The record, or RESOURCE_NOT_FOUND when it is missing or deleted.
 * @throws {Error} Database failures propagate to the caller; a duplicate name during a rename is a database error.
 *
 * @example
 * ```ts
 * const result = await updateProject(transaction, scope, id, 'Production');
 * if (result.ok) {
 *   console.info(result.value.id);
 * } else {
 *   console.warn(result.code);
 * }
 * ```
 */
export async function updateProject(
  transaction: TenantTransaction,
  scope: OrganizationScope,
  id: string,
  name: string,
): Promise<ResourceResult<ProjectRecord>> {
  const record = await renameProject(transaction, scope, id, name);

  if (!record) {
    return {
      ok: false,
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    };
  }

  return {
    ok: true,
    value: record,
  };
}

/**
 * Suspends an undeleted project, preserving its first suspension time.
 *
 * @param transaction - Active tenant transaction after authorization.
 * @param scope - Organization that owns the projects.
 * @param id - ID of the project within the supplied scope.
 * @returns The record, or RESOURCE_NOT_FOUND when it is missing or deleted.
 * @throws {Error} Database failures propagate to the caller.
 *
 * @example
 * ```ts
 * const result = await suspendProject(transaction, scope, id);
 * if (result.ok) {
 *   console.info(result.value.id);
 * } else {
 *   console.warn(result.code);
 * }
 * ```
 */
export async function suspendProject(
  transaction: TenantTransaction,
  scope: OrganizationScope,
  id: string,
): Promise<ResourceResult<ProjectRecord>> {
  const record = await markProjectSuspended(transaction, scope, id);

  if (!record) {
    return {
      ok: false,
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    };
  }

  return {
    ok: true,
    value: record,
  };
}
