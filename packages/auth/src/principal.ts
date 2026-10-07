import type { AuthEngine } from './auth.ts';
import { getSessionCookie } from 'better-auth/cookies';
import * as v from 'valibot';

/**
 * Authenticated identity only; tenant permissions must be checked separately.
 */
export type Principal =
  | { kind: 'human'; userId: string; sessionId: string }
  | { kind: 'service-key'; keyId: string; organizationId: string };

/**
 * Credential or origin denial; rate-limit failures include retryAfter in seconds.
 */
export type AuthenticationFailure =
  | {
      kind: 'denied';
      status: 401 | 403;
      code: 'AUTH_CREDENTIALS_AMBIGUOUS' | 'AUTH_CREDENTIALS_INVALID' | 'AUTH_ORIGIN_INVALID';
    }
  | {
      kind: 'denied';
      status: 429;
      code: 'AUTH_KEY_RATE_LIMITED';
      retryAfter: number;
    };

const rateLimitErrorSchema = v.object({
  details: v.object({ tryAgainIn: v.pipe(v.number(), v.finite(), v.minValue(0)) }),
});

/**
 * Authenticates one session cookie or service key against live authentication state.
 *
 * Mixed credentials are rejected. Unsafe cookie requests require the trusted origin;
 * any supplied origin must match. This function does not authorize a tenant action.
 *
 * @param auth - Engine used to verify keys and read sessions without cookie caching.
 * @param origin - Canonical trusted origin.
 * @param request - Incoming request with its original credential headers.
 * @returns An authenticated principal or a denial with an HTTP status and stable code. Rate-limit denials include retryAfter in seconds.
 * @throws {Error} Authentication backend failures and invalid backend rate-limit data propagate.
 *
 * @example
 * ```ts
 * const principal = await authenticateRequest(auth, origin, request);
 * if (principal.kind === 'denied') {
 *   console.warn(principal.code);
 * }
 * ```
 */
export async function authenticateRequest(
  auth: AuthEngine,
  origin: string,
  request: Request,
): Promise<Principal | AuthenticationFailure> {
  const authorization = request.headers.get('authorization');
  const apiKey = request.headers.get('x-api-key');
  const sessionCookie = getSessionCookie(request);
  const bearer = authorization?.match(/^Bearer ([^\s,]+)$/i)?.[1];

  if (
    (authorization !== null && apiKey !== null) ||
    ((authorization !== null || apiKey !== null) && sessionCookie)
  ) {
    return { kind: 'denied', status: 401, code: 'AUTH_CREDENTIALS_AMBIGUOUS' };
  }

  if (authorization !== null && !bearer) {
    return { kind: 'denied', status: 401, code: 'AUTH_CREDENTIALS_INVALID' };
  }

  const suppliedOrigin = request.headers.get('origin');
  const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);

  if (
    (suppliedOrigin !== null && suppliedOrigin !== origin) ||
    (sessionCookie && unsafeMethod && suppliedOrigin !== origin)
  ) {
    return { kind: 'denied', status: 403, code: 'AUTH_ORIGIN_INVALID' };
  }

  const key = bearer ?? apiKey;

  if (key !== null && key !== undefined) {
    if (!key || key.length > 512 || /[\s,]/.test(key)) {
      return { kind: 'denied', status: 401, code: 'AUTH_CREDENTIALS_INVALID' };
    }

    const verified = await auth.api.verifyApiKey({ body: { key, configId: 'default' } });

    if (!verified.valid || !verified.key) {
      if (verified.error?.code === 'RATE_LIMITED') {
        const { details } = v.parse(rateLimitErrorSchema, verified.error);

        return {
          kind: 'denied',
          status: 429,
          code: 'AUTH_KEY_RATE_LIMITED',
          retryAfter: Math.max(1, Math.ceil(details.tryAgainIn / 1000)),
        };
      }

      return { kind: 'denied', status: 401, code: 'AUTH_CREDENTIALS_INVALID' };
    }

    return {
      kind: 'service-key',
      keyId: verified.key.id,
      organizationId: verified.key.referenceId,
    };
  }

  const active = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });

  if (!active) {
    return { kind: 'denied', status: 401, code: 'AUTH_CREDENTIALS_INVALID' };
  }

  return { kind: 'human', userId: active.user.id, sessionId: active.session.id };
}
