# Delivery and replay semantics

Back to [[plans/01-notification-service/overview]]

## States and truth

- A notification is an immutable request plus aggregate delivery counts. Derive its queued/processing/completed lifecycle and mixed outcome from deliveries rather than updating inconsistent boolean flags.
- Delivery states: queued, sending, retry_wait, provider_accepted, failed, expired, canceled. Only provider_accepted indicates provider acceptance; it does not indicate device receipt, display, open, or read.
- Attempts record their own started/finished timestamps, generation, provider response, and accepted/permanent/transient/ambiguous classification. An unfinished attempt after a crash is not fabricated success.
- No ordering guarantee across independent notifications/endpoints. Do not promise every background notification is presented or that APNs/FCM retain all collapsed messages.

## Reliability contract

- Acceptance and durable queue insertion are one PostgreSQL transaction via pg-boss's transaction adapter. Any suppressed/null enqueue result must be checked; accepted work cannot silently disappear.
- Worker network I/O occurs outside database transactions. A short pre-send transaction reserves logical send-start, checking tenant/environment/notification/endpoint status under a consistent lock order shared with suspension/cancel/disable operations. A committed reservation is in-flight even if physical I/O has not begun; a prior cancellation blocks reservation, not an already reserved external send.
- Short pre/post transactions fence application attempts. Retain the fetched pg-boss claim identity (id and retryCount) separately; all worker settlement/heartbeat calls target that claim, not a plain job ID.
- Final state, attempt result, event append, and claim-aware pg-boss complete/successor insertion share one short transaction. Require completion affected count exactly one; zero/lost claim throws and rolls back all result/event/successor writes. A recovered terminal delivery is acknowledged against its current claim without resending.
- External delivery is at least once under ambiguous failure. A crash after a provider accepts but before the database commits can cause a duplicate. Neither a queue's exactly-once language nor an API idempotency key closes this boundary.
- Bound provider request deadlines below the recovery lease; abort outstanding work on shutdown/lease loss where supported. Fencing protects database state, not a provider send already in flight.

## One retry authority

- Application policy classifies provider outcomes and atomically creates a delayed successor for transient/ambiguous outcomes, honoring Retry-After, jitter, attempt cap, and the absolute notification expiry.
- Complete the current job when that outcome is durably recorded. Do not also throw to activate pg-boss provider-error retries or allow hidden SDK retries; inspect/configure SDK behavior and account for unavoidable SDK retries in the deadline.
- pg-boss retries recover infrastructure crashes/uncommitted attempts only. A reconciler maps exhausted recovery jobs into a visible failed/ambiguous delivery; configure queue retention so unfinished work is never deleted first.
- Credential/topic/project misconfiguration blocks affected configuration and alerts operators; do not invalidate unrelated endpoints. Auth refresh is bounded, not an infinite provider-error loop.
- Terminal invalid-token/subscription responses disable only the attempted endpoint generation. APNs invalidation timestamps also guard newer registrations. Expired TTL is terminal without another send.
- Redrive is a new audited attempt chain, explicitly allowing duplicates; require valid active endpoint/configuration and a fresh permitted expiry.

## SSE correctness

- Persist minimal events in the same transaction as visible state changes. Use an environment stream counter locked through commit; naive bigserial IDs can commit out of order and make cursor replay skip an event.
- Readers use short tenant transactions; cursor includes stream identity. Read events greater than the last acknowledged cursor in bounded batches. Duplicates on reconnect are allowed; clients deduplicate by event ID.
- GET replay and SSE have the same retention boundary. Proposed replay retention is 7 days. A cursor older than the watermark returns 410 event_cursor_expired and requires status resynchronization.
- PostgreSQL LISTEN/NOTIFY is optional low-latency signaling with identifier-only payloads; polling of durable rows remains the correctness path, including reconnects and lost wakeups.
- Start with one shared reader/wakeup per active environment per API replica, not per connection. Heartbeats, bounded stream buffers, slow-client disconnects, revocation checks, and proxy no-buffering settings are required.
- Proposed heartbeat/revocation cadence is 15 seconds; enforce a maximum stream age. Test commit inversion, disconnect/replay, pruning, and authorization loss against two API replicas.
