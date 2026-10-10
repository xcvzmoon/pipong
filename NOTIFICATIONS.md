# Notification request contract

Submit with `POST /api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/notifications`.
Use an authorized session or environment-bound service key with `notification:send`
and a required `Idempotency-Key` header. Keys contain 1–200 ASCII letters, digits,
periods, underscores, colons, or hyphens. JSON content type is required.

Acceptance persists the notification, deduplicated endpoint-generation snapshots,
admission reservation, queued events, and identifier-only jobs in one transaction.
Workers do not send push notifications yet; provider consumers follow fenced
attempts and provider adapter qualification.

## Request

```json
{
  "targets": {
    "kind": "recipients",
    "ids": ["00000000-0000-4000-8000-000000000001"]
  },
  "content": {
    "alert": { "title": "Order ready", "body": "Your order is ready for pickup." },
    "data": { "orderId": "order-123" }
  },
  "expiresAt": "2026-10-10T12:00:00.000Z",
  "overrides": {
    "apns": { "pushType": "alert", "priority": 10 },
    "fcm": { "priority": "NORMAL" },
    "webPush": { "urgency": "normal" }
  }
}
```

- Targets are UUIDs: at most 100 recipient IDs or 1,000 explicit endpoint IDs.
  Acceptance resolves active endpoints in the authorized environment, deduplicate
  them, and enforces a maximum of 1,000 deliveries. Empty expansion is rejected.
- The raw UTF-8 body is limited to 65,536 bytes. The HTTP adapter bounds each
  streaming chunk before buffering and rejects invalid UTF-8.
- Content requires an alert or nonempty data. Alert title/body are nonempty strings;
  data values are strings. Unpaired Unicode surrogates and unknown fields are rejected.
- `expiresAt` is an ISO timestamp at least one second and at most 28 days after the
  acceptance clock. Invalid calendar dates are rejected and expiry is normalized to
  UTC with millisecond precision. Encoders reject expired requests and floor remaining TTL to
  integer seconds. APNs uses absolute epoch seconds. FCM applies expiry to Android,
  APNs, and Web Push destinations; Web Push receives a TTL in seconds.
- Data cannot use `notificationId`, `deliveryId`, `aps`, `from`, `message_type`,
  `collapse_key`, or keys starting with `google.` or `gcm.`. Pipong adds persisted
  notification and delivery UUIDs for client deduplication.

## Provider overrides and limits

APNs supports `pushType: alert` with an alert, priority 5 or 10 (default 10), optional
sound and nonnegative integer badge. `pushType: background` requires data without an
alert and priority 5. Both accept a nonempty collapse ID of at most 64 UTF-8 bytes.
Without an override, alert content selects alert/10; data-only content selects
background/5. The bound credential supplies the topic. Final JSON, including
metadata and escaping, must fit 4,096 bytes.

FCM supports Android priority `NORMAL` (default) or `HIGH` and a nonempty collapse
key of at most 64 Unicode characters. Target identity comes from the endpoint and
uses `fid` for Firebase Installation IDs or the deprecated `token` field for
registration identifiers. The encoder enforces a conservative 4,096-byte bound
on the serialized message, including target, configuration, and metadata, rather
than estimating only content keys and values. The outer `message` envelope is
excluded from this bound. See the [FCM HTTP v1 Message reference](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages).

Web Push supports urgency `very-low`, `low`, `normal` (default), or `high`, and a
replacement topic of 1–32 URL-safe base64 characters. Plaintext JSON contains
`alert` when present and `data` with Pipong IDs. Its 3,993-byte limit leaves 103 bytes
for the standard single-record aes128gcm framing, delimiter, and authentication
tag. Pass the encoded body and options to `web-push.generateRequestDetails`; custom
padding is not supported. See [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html)
and [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html).

Provider options outside these fields, credential overrides, target overrides,
and caller TTL overrides are rejected. Provider acceptance does not prove display
or device receipt.

## Failure results

Helpers return `{ ok: true, value }` or `{ ok: false, problem }`. Problems contain
RFC 9457 `type`, `title`, `status`, stable `code`, and the server-generated
`requestId`. Schema failures include safe JSON pointers in `invalidParams`, limited
to known top-level fields or the document root. They omit input values and validation
messages. The HTTP adapter returns `application/problem+json`.

Body overflow is 413 `NOTIFICATION_BODY_TOO_LARGE`. Other failures are 422:
`NOTIFICATION_INVALID`, `NOTIFICATION_EXPIRY_INVALID`,
`NOTIFICATION_PAYLOAD_TOO_LARGE`, `NOTIFICATION_NO_TARGETS`, or
`NOTIFICATION_TARGET_LIMIT_EXCEEDED`.

The HTTP adapter also rejects missing/invalid idempotency keys with 422
`NOTIFICATION_IDEMPOTENCY_KEY_INVALID`, fingerprint changes with 409
`idempotency_conflict`, and exhausted admission with 429 plus `Retry-After`.
Persistence or queue failures return 503 and roll back the entire acceptance.

## Acceptance and replay

Success returns 202, `Location` pointing to the notification resource, and:

```json
{
  "notificationId": "019a0000-0000-7000-8000-000000000001",
  "acceptedAt": "2026-10-09T09:00:00.000Z",
  "deliveryCount": 2
}
```

The key is scoped to the organization/project/environment and retained for seven
days from acceptance. Concurrent identical requests return the same committed
body and Location. Fingerprints include normalized targets, content, expiry,
overrides, and scope. Target duplicates/order, JSON property order, and explicit
schema defaults do not change the fingerprint. Changed content or targeting with
a live key returns 409; after the window expires, key reuse may create new work.

Every replay checks live authority and request admission. It returns the original
response even if endpoints change or notification expiry passes, without consuming
new fanout/pending capacity. An expired key starts a new acceptance and must pass
current expiry, target, payload, and capacity checks. Revocation, suspension, or
organization disablement blocks replay.

Targets resolve only active recipients, endpoints, and bound credential versions
in the authorized environment. Missing, foreign, deleted, or inactive targets
contribute no work. At least one target must remain. Every resolved payload passes
its provider's final byte bound before any acceptance writes. Deliveries retain
the original endpoint generation and credential binding.

Apply migrations before deployment. Notification summary/delivery inspection,
cancellation, and provider consumers remain later plan work; the Location resource
is reserved for the summary API. A 202 confirms durable queuing, not device delivery.

Run the built HTTP/PostgreSQL suite with `TEST_AUTH_DATABASE_URL` and
`pnpm --filter pipong-server exec vitest run tests/submission.integration.test.ts`.
Use a disposable PostgreSQL 18 cluster; tests create/drop databases and runtime roles.

Worker execution now reserves logical send-start and records fenced attempts in
PostgreSQL before network I/O. Result settlement atomically records provider
classification, delivery events, admission release or a delayed retry job, and
completion of the original queue claim. Stale workers cannot commit results.
See [fenced delivery execution](./packages/database/README.md#fenced-delivery-execution)
for the worker API and cancellation ordering. Provider consumers and public
inspection/cancellation routes remain later plan work.
