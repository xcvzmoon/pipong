# Notification request contract

Phase 15 provides validation and payload encoding through `@pipong/service`.
Notification submission is not exposed yet. Phase 19 will add the authorized,
idempotent POST operation after queue, event, and admission primitives exist.
Workers do not send push notifications yet.

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
  Acceptance will resolve active endpoints in the authorized environment, deduplicate
  them, and enforce a maximum of 1,000 deliveries. Empty expansion is rejected.
- The raw UTF-8 body is limited to 65,536 bytes. The future HTTP adapter must enforce
  this while reading, before buffering. The parser also checks the buffered body.
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
uses either `fid` or `token`. The encoder enforces a conservative 4,096-byte bound
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
messages. The HTTP adapter will return `application/problem+json`.

Body overflow is 413 `NOTIFICATION_BODY_TOO_LARGE`. Other failures are 422:
`NOTIFICATION_INVALID`, `NOTIFICATION_EXPIRY_INVALID`,
`NOTIFICATION_PAYLOAD_TOO_LARGE`, `NOTIFICATION_NO_TARGETS`, or
`NOTIFICATION_TARGET_LIMIT_EXCEEDED`.

The phase-19 acceptance transaction must validate every resolved provider payload
with persisted IDs before creating any jobs. It will also implement scope-bound
idempotency fingerprints and retain immutable endpoint generations. This phase does
not persist notifications, enforce quotas, or promise delivery.
