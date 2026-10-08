import type { Principal } from '@pipong/auth';
import type { DatabaseRuntime } from '@pipong/database';
import type { TenantScope, TenantTransaction } from '@pipong/database/tenancy';
import {
  organizationEnabled,
  readHumanAuthority,
  readKeyAuthority,
  scopeExists,
  scopeSuspended,
} from '@pipong/database/authorization';
import { setTenantScope } from '@pipong/database/tenancy';
import * as v from 'valibot';

/**
 * Validates the domain permission requested by an authorized operation.
 *
 * @example
 * ```ts
 * const action = v.parse(domainActionSchema, 'notification:send');
 * ```
 */
export const domainActionSchema = v.picklist([
  'organization:manage',
  'project:read',
  'project:manage',
  'environment:read',
  'environment:manage',
  'recipient:read',
  'recipient:write',
  'endpoint:read',
  'endpoint:write',
  'credential:read',
  'credential:manage',
  'service-key:read',
  'service-key:manage',
  'notification:read',
  'notification:send',
  'notification:cancel',
  'delivery:read',
  'delivery:redrive',
  'event:read',
]);

/**
 * Permission evaluated against a live human role or service-key grant.
 */
export type DomainAction = v.InferOutput<typeof domainActionSchema>;

/**
 * Authorization denial with its HTTP status and stable application code.
 */
export type AuthorizationFailure = {
  ok: false;
  status: 403 | 404 | 409;
  code:
    | 'AUTH_PERMISSION_DENIED'
    | 'AUTH_SCOPE_NOT_FOUND'
    | 'AUTH_ORGANIZATION_DISABLED'
    | 'AUTH_RECENT_MFA_REQUIRED'
    | 'AUTH_SCOPE_SUSPENDED';
};

/**
 * Authorized callback result; check ok before reading value.
 */
export type AuthorizedResult<Result> =
  | {
      ok: true;
      value: Result;
    }
  | AuthorizationFailure;

const memberActions: ReadonlySet<DomainAction> = new Set([
  'project:read',
  'environment:read',
  'recipient:read',
  'endpoint:read',
  'notification:read',
  'delivery:read',
  'event:read',
]);

const privilegedActions: ReadonlySet<DomainAction> = new Set([
  'organization:manage',
  'project:manage',
  'environment:manage',
  'credential:manage',
  'service-key:manage',
  'delivery:redrive',
]);

const keyActions: ReadonlySet<DomainAction> = new Set([
  'recipient:read',
  'recipient:write',
  'endpoint:read',
  'endpoint:write',
  'notification:read',
  'notification:send',
  'notification:cancel',
  'delivery:read',
  'event:read',
]);

/**
 * Checks live authority and runs an operation in the same tenant transaction.
 *
 * The callback runs only after organization, scope, role or key grants, and any
 * required recent MFA checks pass. Callback failures roll back the transaction.
 *
 * @param database - API database runtime used for authority checks and the operation.
 * @param principal - Previously authenticated human or service key.
 * @param action - Permission required by the operation.
 * @param scope - Validated tenant scope targeted by the operation.
 * @param run - Operation to execute with transaction-local tenant context set.
 * @returns The callback value wrapped in an ok result, or a structured authorization failure.
 * @throws {Error} Database and callback errors propagate to the caller.
 *
 * @example
 * ```ts
 * const result = await withAuthorizedTransaction(
 *   database, principal, 'project:read', scope,
 *   (transaction) => listProjects(transaction, scope, 20, undefined),
 * );
 * if (!result.ok) {
 *   console.warn(result.code);
 * }
 * ```
 */
export function withAuthorizedTransaction<Result>(
  database: DatabaseRuntime,
  principal: Principal,
  action: DomainAction,
  scope: TenantScope,
  run: (transaction: TenantTransaction) => Promise<Result>,
): Promise<AuthorizedResult<Result>> {
  return database.db.transaction(async (transaction): Promise<AuthorizedResult<Result>> => {
    if (!actionScopeAllowed(action, scope.kind)) {
      return {
        ok: false,
        status: 403,
        code: 'AUTH_PERMISSION_DENIED',
      };
    }

    const enabled = await organizationEnabled(
      transaction,
      scope.organizationId,
      action === 'organization:manage' ? 'update' : 'share',
    );
    const now = new Date();

    if (principal.kind === 'human') {
      const authority = await readHumanAuthority(
        transaction,
        principal.userId,
        principal.sessionId,
        scope.organizationId,
        now,
      );

      if (!authority) {
        return {
          ok: false,
          status: 404,
          code: 'AUTH_SCOPE_NOT_FOUND',
        };
      }

      const permitted =
        authority.role === 'owner' ||
        (authority.role === 'admin' && action !== 'organization:manage') ||
        (authority.role === 'member' && memberActions.has(action));

      if (!permitted) {
        return {
          ok: false,
          status: 403,
          code: 'AUTH_PERMISSION_DENIED',
        };
      }

      if (privilegedActions.has(action) && (!authority.twoFactorEnabled || !authority.recentMfa)) {
        return {
          ok: false,
          status: 403,
          code: 'AUTH_RECENT_MFA_REQUIRED',
        };
      }
    } else {
      const grant = await readKeyAuthority(transaction, principal.keyId, now);

      if (
        !grant ||
        principal.organizationId !== scope.organizationId ||
        grant.organizationId !== scope.organizationId ||
        scope.kind !== 'environment' ||
        grant.projectId !== scope.projectId ||
        grant.environmentId !== scope.environmentId
      ) {
        return {
          ok: false,
          status: 404,
          code: 'AUTH_SCOPE_NOT_FOUND',
        };
      }

      if (!keyActions.has(action) || !grant.actions.includes(action)) {
        return {
          ok: false,
          status: 403,
          code: 'AUTH_PERMISSION_DENIED',
        };
      }
    }

    if (!enabled) {
      return {
        ok: false,
        status: 403,
        code: 'AUTH_ORGANIZATION_DISABLED',
      };
    }

    await setTenantScope(transaction, scope);

    if (
      !(await scopeExists(
        transaction,
        scope,
        action === 'project:manage' ? 'update' : 'share',
        action === 'environment:manage' || action === 'credential:manage' ? 'update' : 'share',
      ))
    ) {
      return {
        ok: false,
        status: 404,
        code: 'AUTH_SCOPE_NOT_FOUND',
      };
    }

    if (
      (action === 'notification:send' ||
        action === 'delivery:redrive' ||
        action === 'recipient:write' ||
        action === 'endpoint:write') &&
      (await scopeSuspended(transaction, scope))
    ) {
      return {
        ok: false,
        status: 409,
        code: 'AUTH_SCOPE_SUSPENDED',
      };
    }

    return {
      ok: true,
      value: await run(transaction),
    };
  });
}

function actionScopeAllowed(action: DomainAction, kind: TenantScope['kind']): boolean {
  switch (action) {
    case 'organization:manage':
      return kind === 'organization';
    case 'project:read':
    case 'project:manage':
      return kind === 'organization' || kind === 'project';
    case 'environment:read':
    case 'environment:manage':
      return kind === 'project' || kind === 'environment';
    case 'recipient:read':
    case 'recipient:write':
    case 'endpoint:read':
    case 'endpoint:write':
    case 'credential:read':
    case 'credential:manage':
    case 'service-key:read':
    case 'service-key:manage':
    case 'notification:read':
    case 'notification:send':
    case 'notification:cancel':
    case 'delivery:read':
    case 'delivery:redrive':
    case 'event:read':
      return kind === 'environment';
    default: {
      const unreachable: never = action;
      throw new Error('AUTH_ACTION_INVALID: unsupported domain action', { cause: unreachable });
    }
  }
}
