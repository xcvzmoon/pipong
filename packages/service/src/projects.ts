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
