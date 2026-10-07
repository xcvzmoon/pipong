import type { Principal } from '@pipong/auth';
import { defineHandler } from 'nitro';
import { randomUUID } from 'node:crypto';
import { auth } from '../utils/auth.ts';
import { problemResponse } from '../utils/problem.ts';

declare module 'nitro/h3' {
  interface H3EventContext {
    principal?: Principal;
    requestId?: string;
  }
}

export default defineHandler(async (event) => {
  if (event.url.pathname !== '/api/v1' && !event.url.pathname.startsWith('/api/v1/')) {
    return undefined;
  }

  const requestId = randomUUID();

  event.context.requestId = requestId;
  event.res.headers.set('cache-control', 'no-store');
  event.res.headers.set('x-request-id', requestId);

  try {
    const principal = await auth.authenticate(event.req);

    if (principal.kind === 'denied') {
      const response = problemResponse(principal.status, principal.code, requestId);

      if (principal.status === 429) {
        response.headers.set('retry-after', String(principal.retryAfter));
      }

      return response;
    }

    event.context.principal = principal;
    return undefined;
  } catch {
    console.error('AUTHENTICATION_UNAVAILABLE: authentication lookup failed');
    return problemResponse(503, 'AUTHENTICATION_UNAVAILABLE', requestId);
  }
});
