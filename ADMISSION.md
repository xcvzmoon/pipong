# Distributed admission

Admission stores organization budgets, key request counters, and acceptance
reservations in PostgreSQL. API and worker replicas share the same counters.
Tenant tables use organization-scoped FORCE RLS. Runtime accounts can update
usage but cannot change operator-owned limits.

## Acceptance transaction

Call `admitNotification` from `@pipong/service` after authorization, target
deduplication, and the idempotency fingerprint check. Pass the authorized
transaction, organization ID, authenticated key ID (or `null` for a human),
stable notification ID, and endpoint count.

An accepted decision reserves one request, the endpoint fanout, and pending
delivery slots. Persist notification/delivery state, its acceptance event, and
queue jobs in that same transaction. An enqueue failure must abort the
transaction. Counters and reservations then roll back with the application writes.

A repeated reservation ID with the same endpoint count returns
`{ status: 'accepted', replay: true }` after request admission. It charges one
request and consumes no additional fanout or pending slots. It can replay while
delivery capacity is exhausted. The submission operation must verify the payload
fingerprint before calling admission. Changed endpoint
counts throw `ADMISSION_RESERVATION_CONFLICT`.

Rejections contain a stable code and `retryAfter` in seconds.
The acceptance HTTP adapter must return 429 with `Retry-After`. Request, key, and
fanout rejections use the remaining window duration. Pending-work rejections
suggest retrying after one second; capacity depends on delivery settlement.
Fanout/backlog rejections retain their request charge when the transaction commits.
Request/key rejections charge nothing. Return quota decisions from the transaction
callback so they commit; infrastructure failures must roll back.

Defaults per organization are 120 admitted requests and 1,000 accepted endpoints
per 60-second window, 60 admitted requests per key in that same window, and
10,000 pending deliveries. Windows use the database clock after acquiring the
organization lock. Rollover resets request/fanout usage and leaves pending work
unchanged. These count admission attempts after authorization and validation,
including replay and rejected fanout/backlog. Authentication infrastructure has
its own request protection.

## Settlement and provider claims

Call `releaseNotificationCapacity` in the transaction containing fenced delivery
settlement. Supply the original notification ID and the remaining nonterminal
delivery count derived from locked application state. Retries retain their slot;
terminal outcomes release it. Repeated settlement of the same remaining count
does not release capacity twice. Increasing the count rejects with
`ADMISSION_RESERVATION_INVALID`.

`enqueueDelivery` assigns each job's organization as its pg-boss group. Every
provider consumer must claim through `fetchDeliveryJobs(database, queue, provider)`.
The function serializes fetches per provider in PostgreSQL, checks the total
active claims, and uses pg-boss's distributed group concurrency to skip saturated
tenants. Each call returns at most one job and commits before network I/O.

Provider defaults are 16 active claims globally and four per organization, for
each of APNs, FCM, and Web Push. These bound active queue claims. Fenced attempts,
heartbeats, and bounded transport deadlines must handle stale processes before
provider consumers are enabled.

## Operator configuration and verification

Apply `pnpm migrate` before deploying. Operators can change persisted limits
using migration credentials. Tenant policy lives in `app.tenant_budgets`;
provider policy lives in `app.provider_budgets`. Keep each provider's global cap
greater than its tenant cap. Serialize provider policy updates with its claim
lock, `pg_advisory_xact_lock(hashtextextended('pipong.delivery.apns', 0))`, replacing
`apns` with the provider. Lower limits stop new admission/claims until usage falls
below the new cap. Do not reset pending counters or remove live reservations.

Run the dedicated disposable-cluster suite with `TEST_ADMISSION_DATABASE_URL`
and `pnpm --filter @pipong/database exec vitest run tests/limits.integration.test.ts`.
It creates and drops its own database and runtime roles; use a dedicated cluster,
separate from other database integration suites running concurrently.

Public submission and delivery consumers remain phases 19 and 20. This increment
provides their admission and claim boundaries; HTTP 429 and live provider traffic
are not enabled yet.
