import type { HumanAuth } from './auth.ts';

const publicAuthOperations = new Map([
  ['/sign-in/email', 'POST'],
  ['/organization/invite-member', 'POST'],
  ['/organization/cancel-invitation', 'POST'],
  ['/organization/get-invitation', 'GET'],
  ['/organization/accept-invitation', 'POST'],
  ['/organization/reject-invitation', 'POST'],
  ['/organization/list-user-invitations', 'GET'],
  ['/two-factor/generate-backup-codes', 'POST'],
  ['/two-factor/disable', 'POST'],
  ['/sign-out', 'POST'],
  ['/get-session', 'GET'],
  ['/list-sessions', 'GET'],
  ['/revoke-session', 'POST'],
  ['/revoke-sessions', 'POST'],
  ['/revoke-other-sessions', 'POST'],
  ['/two-factor/enable', 'POST'],
  ['/two-factor/get-totp-uri', 'POST'],
  ['/two-factor/verify-totp', 'POST'],
  ['/two-factor/verify-backup-code', 'POST'],
  ['/request-password-reset', 'POST'],
  ['/reset-password', 'POST'],
  ['/verify-email', 'GET'],
  ['/send-verification-email', 'POST'],
]);

/**
 * Applies the public authentication endpoint allowlist and origin policy.
 *
 * Pass the original request without consuming its body. Allowed responses preserve
 * authentication cookies and receive Cache-Control: no-store.
 *
 * @param auth - HTTP authentication facade with its trusted origin.
 * @param request - Request under /api/auth with its original URL, method, headers, and body.
 * @returns The authentication response, or a 403 problem for an invalid origin or disabled endpoint.
 * @throws {Error} Handler failures propagate to the caller.
 *
 * @example
 * ```ts
 * const response = await handleAuthRequest(auth, request);
 * ```
 */
export function handleAuthRequest(auth: HumanAuth, request: Request): Promise<Response> {
  const origin = request.headers.get('origin');

  if (origin && origin !== auth.origin) {
    return Promise.resolve(
      authProblem('AUTH_ORIGIN_INVALID', 'The request origin is not allowed.'),
    );
  }

  const pathname = new URL(request.url).pathname;
  const operation = pathname.slice('/api/auth'.length);
  const resetCallback = request.method === 'GET' && /^\/reset-password\/[^/]+$/.test(operation);

  if (!resetCallback && publicAuthOperations.get(operation) !== request.method) {
    return Promise.resolve(
      authProblem('AUTH_ENDPOINT_DISABLED', 'This authentication operation is not exposed.'),
    );
  }

  return auth.handler(request).then((response) => {
    response.headers.set('cache-control', 'no-store');
    return response;
  });
}

function authProblem(
  code: 'AUTH_ORIGIN_INVALID' | 'AUTH_ENDPOINT_DISABLED',
  detail: string,
): Response {
  return Response.json(
    { type: 'about:blank', title: 'Forbidden', status: 403, code, detail },
    {
      status: 403,
      headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
    },
  );
}
