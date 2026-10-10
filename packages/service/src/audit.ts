import type { Principal } from '@pipong/auth';
import type { TenantScope, TenantTransaction } from '@pipong/database/tenancy';
import type { DomainAction } from './authorize.ts';
import { appendPrivilegedAudit } from '@pipong/database/audit';

export type { AuditEvent } from '@pipong/database/audit';

export async function auditPrivilegedOperation(
  transaction: TenantTransaction,
  principal: Extract<Principal, { kind: 'human' }>,
  action: DomainAction,
  scope: TenantScope,
): Promise<void> {
  await appendPrivilegedAudit(transaction, {
    organizationId: scope.organizationId,
    projectId: scope.kind === 'organization' ? null : scope.projectId,
    environmentId: scope.kind === 'environment' ? scope.environmentId : null,
    userId: principal.userId,
    sessionId: principal.sessionId,
    action,
  });
}
