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
resuming at the retained watermark. Status queries and SSE streams arrive in
later plan phases.

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

This phase supplies the pruning operation; automatic retention scheduling
belongs to the later lifecycle work. Events are produced by internal callers
until submission and attempt state transitions are implemented. The ledger
and replay endpoint do not enable push delivery consumers.
