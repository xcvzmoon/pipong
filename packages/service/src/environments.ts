import type { ProjectScope, EnvironmentRecord } from '@pipong/database/environments';
import type { TenantTransaction } from '@pipong/database/tenancy';
import type { ResourcePage, ResourceResult } from './resources.ts';
import {
  createEnvironment as insertEnvironment,
  listEnvironments as selectEnvironments,
  readEnvironment as selectEnvironment,
  renameEnvironment,
  suspendEnvironment as markEnvironmentSuspended,
} from '@pipong/database/environments';
import { readProject } from '@pipong/database/projects';
import { readResourceCursor, resourcePage } from './resources.ts';

/**
 * Creates an environment within an authorized project.
 *
 * @param transaction - Active tenant transaction after authorization.
 * @param scope - Project that owns the environments.
 * @param name - Name already validated with resourceInputSchema.
 * @returns The created record, or RESOURCE_NAME_CONFLICT when the name is already reserved. Returns RESOURCE_NOT_FOUND for a missing parent and RESOURCE_SUSPENDED for a suspended parent.
 * @throws {Error} Database failures propagate to the caller.
 *
 * @example
 * ```ts
 * const result = await createEnvironment(transaction, scope, 'Production');
 * if (result.ok) {
 *   console.info(result.value.id);
 * } else {
 *   console.warn(result.code);
 * }
 * ```
 */
export async function createEnvironment(
  transaction: TenantTransaction,
  scope: ProjectScope,
  name: string,
): Promise<ResourceResult<EnvironmentRecord>> {
  const project = await readProject(
    transaction,
    {
      kind: 'organization',
      organizationId: scope.organizationId,
    },
    scope.projectId,
  );

  if (!project) {
    return {
      ok: false,
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    };
  }

  if (project.suspendedAt) {
    return {
      ok: false,
      status: 409,
      code: 'RESOURCE_SUSPENDED',
    };
  }

  const record = await insertEnvironment(transaction, scope, name);

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
 * Lists undeleted environments in ascending ID order using a scope-bound cursor.
 *
 * @param transaction - Active tenant transaction after authorization.
 * @param scope - Project that owns the environments.
 * @param limit - Validated page size from 1 to 100.
 * @param cursor - Cursor from the previous page, or undefined for the first page.
 * @returns A page with a nullable next cursor, or RESOURCE_CURSOR_INVALID for a malformed or mismatched cursor.
 * @throws {Error} Database failures propagate to the caller.
 *
 * @example
 * ```ts
 * const result = await listEnvironments(transaction, scope, 20, undefined);
 * if (result.ok) {
 *   const { items, nextCursor } = result.value;
 *   console.info(items, nextCursor);
 * }
 * ```
 */
export async function listEnvironments(
  transaction: TenantTransaction,
  scope: ProjectScope,
  limit: number,
  cursor: string | undefined,
): Promise<ResourceResult<ResourcePage<EnvironmentRecord>>> {
  const afterId = readResourceCursor(scope, cursor);

  if (afterId === false) {
    return {
      ok: false,
      status: 422,
      code: 'RESOURCE_CURSOR_INVALID',
    };
  }

  const records = await selectEnvironments(transaction, scope, limit + 1, afterId);

  return {
    ok: true,
    value: resourcePage(scope, records, limit),
  };
}

/**
 * Reads an undeleted environment within its owning project.
 *
 * @param transaction - Active tenant transaction after authorization.
 * @param scope - Project that owns the environments.
 * @param id - ID of the environment within the supplied scope.
 * @returns The record, or RESOURCE_NOT_FOUND when it is missing or deleted.
 * @throws {Error} Database failures propagate to the caller.
 *
 * @example
 * ```ts
 * const result = await readEnvironment(transaction, scope, id);
 * if (result.ok) {
 *   console.info(result.value.id);
 * } else {
 *   console.warn(result.code);
 * }
 * ```
 */
export async function readEnvironment(
  transaction: TenantTransaction,
  scope: ProjectScope,
  id: string,
): Promise<ResourceResult<EnvironmentRecord>> {
  const record = await selectEnvironment(transaction, scope, id);

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
 * Renames an undeleted environment within its owning project.
 *
 * @param transaction - Active tenant transaction after authorization.
 * @param scope - Project that owns the environments.
 * @param id - ID of the environment within the supplied scope.
 * @param name - Name already validated with resourceInputSchema.
 * @returns The record, or RESOURCE_NOT_FOUND when it is missing or deleted.
 * @throws {Error} Database failures propagate to the caller; a duplicate name during a rename is a database error.
 *
 * @example
 * ```ts
 * const result = await updateEnvironment(transaction, scope, id, 'Production');
 * if (result.ok) {
 *   console.info(result.value.id);
 * } else {
 *   console.warn(result.code);
 * }
 * ```
 */
export async function updateEnvironment(
  transaction: TenantTransaction,
  scope: ProjectScope,
  id: string,
  name: string,
): Promise<ResourceResult<EnvironmentRecord>> {
  const record = await renameEnvironment(transaction, scope, id, name);

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
 * Suspends an undeleted environment, preserving its first suspension time.
 *
 * @param transaction - Active tenant transaction after authorization.
 * @param scope - Project that owns the environments.
 * @param id - ID of the environment within the supplied scope.
 * @returns The record, or RESOURCE_NOT_FOUND when it is missing or deleted.
 * @throws {Error} Database failures propagate to the caller.
 *
 * @example
 * ```ts
 * const result = await suspendEnvironment(transaction, scope, id);
 * if (result.ok) {
 *   console.info(result.value.id);
 * } else {
 *   console.warn(result.code);
 * }
 * ```
 */
export async function suspendEnvironment(
  transaction: TenantTransaction,
  scope: ProjectScope,
  id: string,
): Promise<ResourceResult<EnvironmentRecord>> {
  const record = await markEnvironmentSuspended(transaction, scope, id);

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
