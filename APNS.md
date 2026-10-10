# APNs delivery

APNs is an internal worker capability. Provider queue consumers remain disabled until
all provider adapters are integrated. The public submission, credential, and endpoint
APIs already bind each delivery to an immutable credential and endpoint generation.

`createApnsRuntime()` decrypts a committed send reservation, checks its topic and
sandbox/production binding, and encodes the final alert or background payload. It
uses Apple's explicit HTTPS HTTP/2 endpoints with certificate verification. It
never infers the APNs environment from `NODE_ENV`.

The runtime holds at most 32 clients, each with one connection and one in-flight
request. Cache identities include organization, project, environment, credential
version, topic, APNs environment, Team ID, and Key ID. Idle clients are evicted at
the limit; a full busy cache rejects work. The worker owner must call `close()` on
shutdown. It destroys connections and resolves interrupted sends as ambiguous.
JWTs use ES256 and refresh after 50 minutes. Requests have a ten-second total
deadline and an 8 KiB response limit.

A 200 response means provider acceptance, not device receipt. The adapter preserves
status, `apns-id`, reason, invalidation timestamp, and `Retry-After`. Transport
interruptions and malformed responses are ambiguous. The transport sends once;
application settlement controls any successor attempt.

The shared recovery policy schedules both 429 and 5xx retries after at least
15 minutes. A longer numeric or HTTP-date `Retry-After` extends that delay. A retry
that cannot fit before notification expiry settles as expired. Other APNs errors
are permanent for the attempt; authentication and topic failures do not disable
the endpoint.

`settleApnsDelivery()` atomically stores the receipt, settles the attempt, publishes
the event, releases admission or creates a successor, and completes the original
queue claim. A 410 `Unregistered` response disables only the attempted generation
whose registration predates the provider's millisecond timestamp. Refreshed
registrations survive stale responses. Lost claims roll back every change.

## Library audit

The released [@parse/node-apn 8.1.0 package](https://registry.npmjs.org/@parse/node-apn/-/node-apn-8.1.0.tgz)
was inspected on 2026-10-10. Its `lib/client.js` retries 408/429/5xx responses,
removes `retryAfter` before returning failures, reads `Retry-After` with the wrong
HTTP/2 header casing, and replaces some provider reasons with generic errors.
Setting its retry limit to zero removes retries but does not restore the lost
response fields. Pipong therefore uses Node's HTTP/2 and crypto APIs directly.
No APNs SDK dependency or patched SDK internals are required.

## Verification

Local TLS HTTP/2 fixtures cover alert/background headers, ES256 signatures and
refresh, binding checks, raw 410 receipts, retry hints and floors, malformed and
oversized responses, GOAWAY, shutdown, and rejection of untrusted certificates.
PostgreSQL tests cover generation/timestamp races, receipt persistence, admission
release, and rollback on a lost claim.

Sandbox and production app/device sends remain release gates. Local fixtures do
not prove Apple acceptance or device delivery.
