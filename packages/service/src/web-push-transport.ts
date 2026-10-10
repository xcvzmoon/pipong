import type { IncomingHttpHeaders } from 'node:http';
import type { RequestDetails } from 'web-push';
import type { DestinationResolver, EgressPolicy } from './egress.ts';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { validateDestination } from './egress.ts';

export type WebPushResponse = { statusCode: number; headers: IncomingHttpHeaders; body: Buffer };

/**
 * Sends web-push generated request details over a fresh, screened HTTPS connection.
 * @param details - Output of web-push generateRequestDetails; no proxy or custom agent is used.
 * @param policy - Deployment-owned limits, exceptions, and optional private CA trust.
 * @param resolver - Trusted DNS resolver override for deployment or protocol fixtures.
 * @returns Bounded provider response, including non-success status and Retry-After. Redirects are rejected.
 * @throws {Error} EGRESS_DEADLINE, EGRESS_REDIRECT, EGRESS_RESPONSE_LIMIT, EGRESS_NETWORK_FAILED, or destination validation codes. Errors omit URLs and provider bodies.
 * @example
 * ```ts
 * const details = webpush.generateRequestDetails(subscription, payload, { contentEncoding: 'aes128gcm', vapidDetails });
 * const response = await sendWebPushRequest(details, policy);
 * ```
 */
export async function sendWebPushRequest(
  details: RequestDetails,
  policy: EgressPolicy,
  resolver?: DestinationResolver,
): Promise<WebPushResponse> {
  const controller = new AbortController();
  const deadlineAt = Date.now() + policy.totalTimeoutMs;
  const deadlineError = new Error('EGRESS_DEADLINE: request deadline exceeded');
  const timer = setTimeout(() => {
    controller.abort(deadlineError);
  }, policy.totalTimeoutMs);
  let abortListener: (() => void) | undefined;

  try {
    const destination = await Promise.race([
      validateDestination(details.endpoint, policy, resolver),
      new Promise<never>((_resolve, reject) => {
        abortListener = () => {
          reject(deadlineError);
        };
        controller.signal.addEventListener('abort', abortListener, { once: true });
      }),
    ]);
    if (Date.now() >= deadlineAt) {
      throw deadlineError;
    }
    const hostname = destination.url.hostname.replace(/^\[|\]$/g, '');

    return await new Promise<WebPushResponse>((resolve, reject) => {
      const outgoing = request(
        destination.url,
        {
          method: 'POST',
          headers: { ...details.headers, host: destination.url.host },
          agent: false,
          family: destination.family,
          lookup: (_hostname, _options, callback) => {
            callback(null, destination.address, destination.family);
          },
          servername: isIP(hostname) ? '' : hostname,
          checkServerIdentity: (_servername, certificate) =>
            checkServerIdentity(hostname, certificate),
          rejectUnauthorized: true,
          ca: destination.ca,
          maxHeaderSize: 16384,
          signal: controller.signal,
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;

          if (statusCode >= 300 && statusCode < 400) {
            outgoing.destroy(new Error('EGRESS_REDIRECT: provider redirects are forbidden'));
            response.destroy();
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;

            if (size > policy.maxResponseBytes) {
              const error = new Error('EGRESS_RESPONSE_LIMIT: provider response is too large');
              reject(error);
              outgoing.destroy(error);
              response.destroy();
              return;
            }

            chunks.push(chunk);
          });
          response.on('error', () => {
            reject(new Error('EGRESS_NETWORK_FAILED: provider response failed'));
          });
          response.on('end', () => {
            resolve({ statusCode, headers: response.headers, body: Buffer.concat(chunks) });
          });
        },
      );
      outgoing.setTimeout(policy.idleTimeoutMs, () => {
        outgoing.destroy(deadlineError);
      });
      outgoing.on('error', (error: Error) => {
        if (controller.signal.aborted) {
          reject(deadlineError);
        } else if (error.message.startsWith('EGRESS_')) {
          reject(error);
        } else {
          reject(new Error('EGRESS_NETWORK_FAILED: provider connection failed'));
        }
      });
      outgoing.end(details.body);
    });
  } finally {
    clearTimeout(timer);

    if (abortListener) {
      controller.signal.removeEventListener('abort', abortListener);
    }
  }
}
