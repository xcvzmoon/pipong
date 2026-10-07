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
