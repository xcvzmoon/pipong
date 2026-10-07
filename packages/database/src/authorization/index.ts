import type { TenantScope, TenantTransaction } from '../tenancy/index.ts';
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { apikeys, members, mfaAssurances, organizations, sessions, users } from '../auth/schema.ts';
import { environments, projects } from '../tenancy/schema.ts';
import { serviceKeyGrants } from './schema.ts';

/**
 * Reads and share-locks the live session, verified user, membership, and MFA authority.
 *
 * @param transaction - Transaction containing the subsequent authorized operation.
 * @param userId - Authenticated user ID.
 * @param sessionId - Session that must belong to the user and remain unexpired.
 * @param organizationId - Organization whose membership is required.
 * @param now - Time used for session expiry and the five-minute MFA window.
 * @returns Membership role and MFA state, or undefined if the session, user, or unique membership is invalid.
 * @throws {Error} Database query failures propagate.
 *
 * @example
 * ```ts
 * const authority = await readHumanAuthority(transaction, userId, sessionId, organizationId, new Date());
 * ```
 */
export async function readHumanAuthority(
  transaction: TenantTransaction,
  userId: string,
  sessionId: string,
  organizationId: string,
  now: Date,
): Promise<{ role: string; twoFactorEnabled: boolean; recentMfa: boolean } | undefined> {
  const [session] = await transaction
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, now),
        isNull(sessions.deletedAt),
      ),
    )
    .for('share');

  if (!session) {
    return undefined;
  }

  const [user] = await transaction
    .select({ twoFactorEnabled: users.twoFactorEnabled })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.emailVerified, true), isNull(users.deletedAt)))
    .for('share');

  if (!user) {
    return undefined;
  }

  const membership = await transaction
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        eq(members.userId, userId),
        eq(members.organizationId, organizationId),
        isNull(members.deletedAt),
      ),
    )
    .for('share');
  const member = membership.length === 1 ? membership[0] : undefined;

  if (!member) {
    return undefined;
  }

  const [assurance] = await transaction
    .select({ sessionId: mfaAssurances.sessionId })
    .from(mfaAssurances)
    .where(
      and(
        eq(mfaAssurances.sessionId, sessionId),
        gt(mfaAssurances.verifiedAt, new Date(now.getTime() - 300_000)),
        lte(mfaAssurances.verifiedAt, now),
      ),
    )
    .for('share');

  return {
    role: member.role,
    twoFactorEnabled: user.twoFactorEnabled === true,
    recentMfa: assurance !== undefined,
  };
}

/**
 * Reads and share-locks a live default API key and its environment grant.
 *
 * @param transaction - Transaction containing the subsequent authorized operation.
 * @param keyId - Previously authenticated service key ID.
 * @param now - Time used to reject expired keys.
 * @returns Matching organization, project, environment, and actions, or undefined for an invalid key or absent grant.
 * @throws {Error} Database query failures propagate.
 *
 * @example
 * ```ts
 * const grant = await readKeyAuthority(transaction, keyId, new Date());
 * ```
 */
export async function readKeyAuthority(
  transaction: TenantTransaction,
  keyId: string,
  now: Date,
): Promise<
  | { organizationId: string; projectId: string; environmentId: string; actions: string[] }
  | undefined
> {
  const [key] = await transaction
    .select({ organizationId: apikeys.referenceId, expiresAt: apikeys.expiresAt })
    .from(apikeys)
    .where(
      and(
        eq(apikeys.id, keyId),
        eq(apikeys.configId, 'default'),
        eq(apikeys.enabled, true),
        isNull(apikeys.deletedAt),
      ),
    )
    .for('share');

  if (!key || (key.expiresAt !== null && key.expiresAt <= now)) {
    return undefined;
  }

  const [grant] = await transaction
    .select({
      organizationId: serviceKeyGrants.organizationId,
      projectId: serviceKeyGrants.projectId,
      environmentId: serviceKeyGrants.environmentId,
      actions: serviceKeyGrants.actions,
    })
    .from(serviceKeyGrants)
    .where(
      and(
        eq(serviceKeyGrants.keyId, keyId),
        eq(serviceKeyGrants.organizationId, key.organizationId),
        isNull(serviceKeyGrants.deletedAt),
      ),
    )
    .for('share');

  return grant;
}

/**
 * Locks an organization row and checks that it is neither disabled nor deleted.
 *
 * @param transaction - Transaction containing the authorized operation.
 * @param organizationId - Organization to inspect.
 * @param lock - Share lock for reads or update lock for organization management.
 * @returns True for an existing enabled organization.
 * @throws {Error} Database query failures propagate.
 *
 * @example
 * ```ts
 * const enabled = await organizationEnabled(transaction, organizationId, 'share');
 * ```
 */
export async function organizationEnabled(
  transaction: TenantTransaction,
  organizationId: string,
  lock: 'share' | 'update',
): Promise<boolean> {
  const [organization] = await transaction
    .select({ disabledAt: organizations.disabledAt, deletedAt: organizations.deletedAt })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for(lock);

  return organization?.disabledAt === null && organization.deletedAt === null;
}

/**
 * Checks and locks undeleted project and environment rows belonging to a scope.
 *
 * Organization scopes return true; check organizationEnabled separately first.
 *
 * @param transaction - Transaction with tenant context set.
 * @param scope - Validated scope whose hierarchy must exist.
 * @param projectLock - Lock mode for the project row.
 * @param environmentLock - Lock mode for the environment row, when applicable.
 * @returns Whether all project and environment rows required by the scope exist.
 * @throws {Error} Database query failures propagate.
 *
 * @example
 * ```ts
 * const exists = await scopeExists(transaction, scope, 'share', 'share');
 * ```
 */
export async function scopeExists(
  transaction: TenantTransaction,
  scope: TenantScope,
  projectLock: 'share' | 'update',
  environmentLock: 'share' | 'update',
): Promise<boolean> {
  if (scope.kind === 'organization') {
    return true;
  }

  const [project] = await transaction
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, scope.projectId),
        eq(projects.organizationId, scope.organizationId),
        isNull(projects.deletedAt),
      ),
    )
    .for(projectLock);

  if (!project) {
    return false;
  }

  if (scope.kind === 'project') {
    return true;
  }

  const [environment] = await transaction
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.id, scope.environmentId),
        eq(environments.organizationId, scope.organizationId),
        eq(environments.projectId, scope.projectId),
        isNull(environments.deletedAt),
      ),
    )
    .for(environmentLock);

  return environment !== undefined;
}

/**
 * Checks whether a scope's project or environment is suspended.
 *
 * Call after scopeExists; a missing row is not treated as suspended.
 *
 * @param transaction - Transaction with tenant context set and scope rows already checked.
 * @param scope - Existing organization, project, or environment scope.
 * @returns True when the project or environment is suspended; false for organization scopes.
 * @throws {Error} Database query failures propagate.
 *
 * @example
 * ```ts
 * const suspended = await scopeSuspended(transaction, scope);
 * ```
 */
export async function scopeSuspended(
  transaction: TenantTransaction,
  scope: TenantScope,
): Promise<boolean> {
  if (scope.kind === 'organization') {
    return false;
  }

  const [project] = await transaction
    .select({ suspendedAt: projects.suspendedAt })
    .from(projects)
    .where(
      and(eq(projects.organizationId, scope.organizationId), eq(projects.id, scope.projectId)),
    );

  if (project?.suspendedAt) {
    return true;
  }

  if (scope.kind === 'project') {
    return false;
  }

  const [environment] = await transaction
    .select({ suspendedAt: environments.suspendedAt })
    .from(environments)
    .where(
      and(
        eq(environments.organizationId, scope.organizationId),
        eq(environments.projectId, scope.projectId),
        eq(environments.id, scope.environmentId),
      ),
    );

  return environment?.suspendedAt !== null && environment?.suspendedAt !== undefined;
}
