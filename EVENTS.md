# Delivery event replay

Read retained events with:

```text
GET /api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/events
```

Use a human session or an environment-bound service key with `event:read`.
Membership, key grants, revocation, and nested resource ownership are checked
on every request. Suspended environments remain readable.

The optional `limit` is 1–100 (default 50). Pass the returned `nextCursor` as
`cursor` to resume after the last event received. A page contains `items`,
`nextCursor`, `watermark`, and `hasMore`. Even an empty page has a resume cursor.
Without a cursor, replay starts at the oldest retained event.

Each event contains `id`, `notificationId`, `deliveryId`, `state`, and
`createdAt`. IDs are opaque and bound to the organization, project, and
environment. Deduplicate by `id` when reconnecting or repeating a request.
No payload, recipient identity, endpoint target, or provider response is included.
`provider_accepted` means provider acceptance; it does not establish device receipt.

Malformed, wrong-environment, and future cursors return 422
`event_cursor_invalid`. When pruning removes history after your cursor, replay
returns 410 `event_cursor_expired`. Resynchronize delivery status before
resuming at the retained watermark. [Status queries](./OBSERVATION.md) expose
the committed notification and delivery state.

## Transaction and retention rules

Run migrations before deploying this endpoint. `recordDeliveryEvent` from
`@pipong/service` appends an event in the transaction that changes delivery
state. The caller must authorize the environment and let failures roll back
that transaction. The per-environment counter lock lasts through commit, so a
later writer cannot commit an event ahead of an earlier sequence. Never hold
this transaction open during provider network requests. Acquire stream locks
in a consistent order when a transaction touches several environments.

`pruneDeliveryEvents` from `@pipong/database/events` runs in a worker tenant
transaction. It removes only a contiguous prefix at least seven days old and
advances the replay watermark in the same transaction. Replay holds a shared
stream lock so pruning cannot remove rows between its watermark check and page
read. Runtime accounts cannot update event history; the API cannot delete it
or advance retention watermarks.

Automatic retention scheduling belongs to the later lifecycle work. Submission,
attempt settlement, cancellation, and recovery append events atomically with
their state changes. Push delivery consumers remain disabled.

## Live streams

```text
GET /api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/events/stream
```

Authenticate with a same-origin session cookie, or use an authenticated fetch
stream with an `event:read` service key. Standard browser EventSource cannot set
bearer headers. Never put credentials in a URL.

Set `Last-Event-ID` to your last processed event ID when reconnecting, or supply
`cursor` for the initial request. Supplying both is allowed only when they match.
Without a cursor, streaming starts at retained history. Invalid, foreign, future,
and expired cursors receive the same 422/410 results as page replay before a
stream opens. Each `delivery` SSE message has an `id` and JSON `data` matching the
page event envelope. Deduplicate by ID. Heartbeats are comments every 15 seconds
and do not advance the resume cursor.

Each API process shares one durable polling reader per environment. Polls run
at one-second intervals without overlapping, check each subscriber's current
session/membership or key/grant authority, then read one bounded page per distinct
subscriber cursor. Historical replay and live subscribers advance independently.
Event-read transactions use a one-second statement timeout and a 250-millisecond
lock timeout; a blocked reader closes its affected streams.
Database transactions finish before writing to clients. Revocation, disabled
organizations, deleted scopes, persistence failure, or history pruned past a
subscriber's cursor closes the stream. Reconnect with your last processed ID;
use the replay endpoint to diagnose a cursor failure and resynchronize status
when it returns 410. Authorization is rechecked on every reconnect.

Process limits are 256 streams, 64 streams per environment, and 64 active
readers. Exhaustion returns 429 `EVENT_STREAM_CAPACITY` with `Retry-After: 5`.
Each connection has at most 100 queued messages and one write in progress.
A full queue or a write taking five seconds closes that connection. A slow client
does not hold a database connection or block other subscribers. Disconnect and
shutdown cleanup release subscription slots and cancel pending writes.

Responses set `Cache-Control: no-store` and `X-Accel-Buffering: no`. Configure
TLS proxies to pass chunks immediately, disable compression/buffering for this
route, and allow an idle timeout longer than the heartbeat interval. Two API
replicas need only the same PostgreSQL event ledger; no sticky routing or
in-process event publication is required.

The pinned Node runtime disables graceful shutdown when `CI` or `TEST` is set.
Leave both unset in deployments that require graceful stream shutdown.
