import type { JWT } from 'google-auth-library';
import { GaxiosError } from 'gaxios';
import { JWT as GoogleJwt } from 'google-auth-library';
import { AsyncLocalStorage } from 'node:async_hooks';

export type FcmAuth = {
  getAccessToken: (signal: AbortSignal) => Promise<string>;
  close?: () => void;
};
type AuthExchangeResult = { ok: true; token: string } | { ok: false; error: FcmAuthError };
type AuthExchange = {
  controller: AbortController;
  promise: Promise<AuthExchangeResult>;
  waiters: number;
};

function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('FCM_AUTH_ABORTED'));
      return;
    }
    const onAbort = (): void => {
      reject(new Error('FCM_AUTH_ABORTED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      () => {
        signal.removeEventListener('abort', onAbort);
        reject(new Error('FCM_AUTH_FAILED'));
      },
    );
  });
}

export class FcmAuthError extends Error {
  statusCode: number | null;
  permanent: boolean;

  constructor(statusCode: number | null, permanent: boolean, cause: Error) {
    super(permanent ? 'FCM_AUTH_INVALID_CREDENTIALS' : 'FCM_AUTH_UNAVAILABLE', { cause });
    this.statusCode = statusCode;
    this.permanent = permanent;
  }
}

/**
 * Creates an FCM-scoped OAuth client for one immutable credential version. Active callers share one refresh; each caller can leave independently, and the last departing caller or client shutdown cancels the exchange.
 * @param clientEmail - Service account email from the encrypted credential.
 * @param privateKey - RSA private key from the encrypted credential.
 * @param tokenFetch - OAuth exchange transport; defaults to direct HTTPS fetch.
 * @returns A client that caches its short-lived OAuth token and owns refresh cancellation.
 * @throws {Error} FCM_AUTH_ABORTED is thrown when the caller or client closes; OAuth failures are reported as FcmAuthError.
 * @example
 * ```ts
 * const auth = createFcmAuth(clientEmail, privateKey);
 * const signal = new AbortController().signal;
 * const accessToken = await auth.getAccessToken(signal);
 * auth.close?.();
 * ```
 */
export function createFcmAuth(
  clientEmail: string,
  privateKey: string,
  tokenFetch: typeof fetch = fetch,
): FcmAuth {
  const requestSignal = new AsyncLocalStorage<AbortSignal>();
  const closeController = new AbortController();
  let exchange: AuthExchange | undefined;
  let closed = false;
  const client: JWT = new GoogleJwt({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    transporterOptions: {
      timeout: 10_000,
      retry: false,
      retryConfig: { retry: 0 },
      fetchImplementation: (input, init) => {
        const signals = [init?.signal, requestSignal.getStore(), closeController.signal].filter(
          (signal): signal is AbortSignal => signal !== undefined,
        );
        return tokenFetch(input, { ...init, signal: AbortSignal.any(signals) });
      },
    },
  });
  async function getAccessToken(signal: AbortSignal): Promise<string> {
    if (closed || signal.aborted) {
      throw new Error('FCM_AUTH_ABORTED');
    }
    const pendingExchange = exchange;
    if (pendingExchange?.controller.signal.aborted) {
      await waitFor(pendingExchange.promise, signal).catch(() => undefined);
      return getAccessToken(signal);
    }
    const activeExchange = pendingExchange ?? startExchange();
    activeExchange.waiters += 1;
    try {
      const result = await waitFor(activeExchange.promise, signal);
      if (!result.ok) {
        throw result.error;
      }
      return result.token;
    } finally {
      activeExchange.waiters -= 1;
      if (activeExchange.waiters === 0 && !closed) {
        activeExchange.controller.abort();
      }
    }
  }
  function startExchange(): AuthExchange {
    const controller = new AbortController();
    const promise = requestSignal.run(controller.signal, async (): Promise<AuthExchangeResult> => {
      try {
        const result = await client.getAccessToken();
        if (!result.token) {
          throw new Error('FCM_AUTH_TOKEN_MISSING');
        }
        return { ok: true, token: result.token };
      } catch (error) {
        const statusCode = error instanceof GaxiosError ? (error.response?.status ?? null) : null;
        const permanent =
          (error instanceof Error && /invalid_grant|invalid_client/i.test(error.message)) ||
          (statusCode !== null &&
            statusCode >= 400 &&
            statusCode < 500 &&
            statusCode !== 408 &&
            statusCode !== 429);
        return {
          ok: false,
          error: new FcmAuthError(
            statusCode,
            permanent,
            error instanceof Error ? error : new Error('FCM_AUTH_FAILED'),
          ),
        };
      }
    });
    const activeExchange = { controller, promise, waiters: 0 };
    exchange = activeExchange;
    void promise.then(
      () => {
        if (exchange === activeExchange) {
          exchange = undefined;
        }
      },
      () => {
        if (exchange === activeExchange) {
          exchange = undefined;
        }
      },
    );
    return activeExchange;
  }
  function close(): void {
    closed = true;
    exchange?.controller.abort();
    closeController.abort();
  }
  return { getAccessToken, close };
}
