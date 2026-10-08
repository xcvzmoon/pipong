import type { LookupAddress } from 'node:dns';
import ipaddr from 'ipaddr.js';
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import * as v from 'valibot';

const privateOriginSchema = v.strictObject({
  origin: v.pipe(v.string(), v.url()),
  cidrs: v.pipe(v.array(v.string()), v.minLength(1), v.maxLength(32)),
  ca: v.optional(v.pipe(v.string(), v.maxLength(65536))),
});
const egressPolicySchema = v.strictObject({
  privateOrigins: v.optional(v.pipe(v.array(privateOriginSchema), v.maxLength(32)), []),
  totalTimeoutMs: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60000)),
    10000,
  ),
  idleTimeoutMs: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60000)),
    5000,
  ),
  maxResponseBytes: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65536)),
    8192,
  ),
});

export type EgressPolicy = v.InferOutput<typeof egressPolicySchema>;
export type AllowedDestination = { url: URL; address: string; family: number; ca?: string };
export type DestinationResolver = (hostname: string) => Promise<LookupAddress[]>;

function destinationUrl(endpoint: string): URL {
  try {
    const url = new URL(endpoint);

    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error('Invalid URL');
    }

    return url;
  } catch {
    throw new Error(
      'EGRESS_DESTINATION_INVALID: expected an HTTPS destination without credentials or fragment',
    );
  }
}

/**
 * Loads deployment-owned egress exceptions. Never pass tenant input as policy.
 * @param reference - Absolute JSON file path, or undefined for public HTTPS on port 443 only.
 * @returns Validated limits and exact private-origin/CIDR exceptions; TLS verification remains enabled.
 * @throws {Error} EGRESS_POLICY_INVALID when the file or policy is invalid.
 * @example
 * ```ts
 * const policy = await loadEgressPolicy('/run/secrets/egress.json');
 * ```
 */
export async function loadEgressPolicy(reference?: string): Promise<EgressPolicy> {
  try {
    let policy = v.parse(egressPolicySchema, {});

    if (reference !== undefined) {
      if (!reference.startsWith('/')) {
        throw new Error('Invalid path');
      }

      const content = await readFile(reference, 'utf8');

      if (Buffer.byteLength(content) > 262144) {
        throw new Error('Invalid size');
      }

      const input: unknown = JSON.parse(content);
      policy = v.parse(egressPolicySchema, input);
    }

    for (const { origin, cidrs } of policy.privateOrigins) {
      const url = destinationUrl(origin);

      if (url.origin !== origin) {
        throw new Error('Expected canonical origin');
      }

      for (const cidr of cidrs) {
        ipaddr.parseCIDR(cidr);
      }
    }

    return policy;
  } catch {
    throw new Error('EGRESS_POLICY_INVALID: cannot load egress policy');
  }
}

async function resolveHostname(hostname: string): Promise<LookupAddress[]> {
  return lookup(hostname, { all: true, order: 'verbatim' });
}

/**
 * Screens every DNS answer and returns one address for a new pinned connection.
 * @param endpoint - Subscription HTTPS URL; credentials and fragments are forbidden.
 * @param policy - Deployment-owned policy loaded by loadEgressPolicy.
 * @param resolver - Trusted DNS resolver; defaults to the system resolver. Never accept it from tenants.
 * @returns Original URL and a screened address, with optional operator CA trust.
 * @throws {Error} EGRESS_DESTINATION_INVALID, EGRESS_DESTINATION_BLOCKED, or EGRESS_DNS_FAILED. Errors omit destination secrets.
 * @example
 * ```ts
 * const destination = await validateDestination(subscription.endpoint, policy);
 * ```
 */
export async function validateDestination(
  endpoint: string,
  policy: EgressPolicy,
  resolver: DestinationResolver = resolveHostname,
): Promise<AllowedDestination> {
  const url = destinationUrl(endpoint);
  const exception = policy.privateOrigins.find(({ origin }) => origin === url.origin);

  if (url.port && url.port !== '443' && !exception) {
    throw new Error('EGRESS_DESTINATION_BLOCKED: port is not permitted');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: LookupAddress[];

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const family = isIP(hostname);
    addresses = family
      ? [{ address: hostname, family }]
      : await Promise.race([
          resolver(hostname),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new Error('DNS deadline'));
            }, policy.totalTimeoutMs);
          }),
        ]);
  } catch {
    throw new Error('EGRESS_DNS_FAILED: destination resolution failed');
  } finally {
    clearTimeout(timer);
  }

  if (addresses.length === 0 || addresses.length > 64) {
    throw new Error('EGRESS_DESTINATION_BLOCKED: invalid DNS answers');
  }

  for (const { address, family } of addresses) {
    if (!isIP(address) || isIP(address) !== family) {
      throw new Error('EGRESS_DESTINATION_BLOCKED: invalid DNS address');
    }

    const parsed = ipaddr.process(address);
    let allowed = parsed.range() === 'unicast';

    if (!allowed && exception) {
      for (const cidr of exception.cidrs) {
        const [network, prefix] = ipaddr.parseCIDR(cidr);

        if (parsed.kind() === network.kind() && parsed.match(network, prefix)) {
          allowed = true;
          break;
        }
      }
    }

    if (!allowed) {
      throw new Error('EGRESS_DESTINATION_BLOCKED: DNS address is not permitted');
    }
  }

  const first = addresses[0];

  if (!first) {
    throw new Error('EGRESS_DESTINATION_BLOCKED: missing DNS address');
  }

  return { url, address: first.address, family: first.family, ca: exception?.ca };
}
