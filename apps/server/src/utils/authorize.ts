import type { TenantScope, TenantTransaction } from '@pipong/database/tenancy';
import type { DomainAction } from '@pipong/service';
import type { H3Event } from 'nitro/h3';
import { isResourceNameConflict } from '@pipong/database/projects';
import { withAuthorizedTransaction } from '@pipong/service';
import { database } from './auth.ts';
import { problemResponse } from './problem.ts';

export async function withAuthorizedRequest(
  event: H3Event,
  action: DomainAction,
  scope: TenantScope,
  run: (transaction: TenantTransaction) => Promise<Response>,
): Promise<Response> {
  const { principal, requestId } = event.context;

  if (!principal || !requestId) {
    return problemResponse(401, 'AUTH_CREDENTIALS_INVALID', requestId ?? 'unavailable');
  }

  try {
    const result = await withAuthorizedTransaction(database, principal, action, scope, run);

    if (!result.ok) {
      return problemResponse(result.status, result.code, requestId);
    }

    result.value.headers.set('cache-control', 'no-store');
    result.value.headers.set('x-request-id', requestId);

    return result.value;
  } catch (error) {
    if (error instanceof Error && isResourceNameConflict(error)) {
      return problemResponse(409, 'RESOURCE_NAME_CONFLICT', requestId);
    }

    console.error('AUTHORIZATION_UNAVAILABLE: authorized transaction failed');
    return problemResponse(503, 'AUTHORIZATION_UNAVAILABLE', requestId);
  }
}
