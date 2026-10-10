# Delivery recovery

Recovery is an internal integration increment. Provider consumers remain disabled;
live device/browser qualification and the release gates are still open.

## Retry policy

Provider errors use application retries. Settlement completes the current queue
claim and atomically inserts one delayed successor, records the attempt and event,
and retains the delivery's pending admission slot. Queue retries recover crashes
and uncommitted infrastructure work; they are not a second provider retry policy.

Each delivery chain permits at most eight committed send reservations, including
crash recovery sends. APNs retries wait at least 15 minutes. FCM and Web Push wait
at least 10 seconds; FCM quota responses retain their 60-second minimum. Delays grow
exponentially up to one hour, with additive jitter up to 20%. Provider Retry-After
is a lower bound. A successor at or beyond the absolute expiry becomes `expired`.
Permanent failures do not create successors. Accepted responses remain
`provider_accepted`, which does not establish device receipt.

A crash after external acceptance can duplicate a later send. Recovered unfinished
attempts are recorded as `ambiguous`, never fabricated as successful. Recovery at
the attempt cap, expiry, or cancellation also closes unfinished attempt history.

## Pending cancellation

Use the environment-scoped route:

```text
POST /api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/notifications/{notificationId}/cancel
```

The caller needs `notification:cancel`. Success returns 200 with `notificationId`
and `canceledCount`, the number newly canceled. Repeating cancellation returns zero.
Missing or foreign notifications return 404 `NOTIFICATION_NOT_FOUND`.

Cancellation locks the notification and changes only `queued` and `retry_wait`
deliveries. Their events and pending-slot release commit together. A send reservation
committed before cancellation stays in flight. Its accepted/permanent response is
recorded truthfully; a transient or ambiguous response after cancellation becomes
`canceled` without scheduling another send.

## Privileged redrive

Use the environment-scoped route:

```text
POST /api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/deliveries/{deliveryId}/redrive
```

Only a human owner/admin with recent MFA may redrive. Service keys cannot. The body
contains a fresh `expiresAt` timestamp and a `reason` of one to 500 characters.
Expiry must be at least one second and at most 24 hours from database time.

The source must be `failed`, `expired`, or `canceled`. Its current endpoint,
recipient, credential, organization, and environment must be eligible. Redrive
creates a new notification and delivery, snapshots the current endpoint generation,
reserves admission, records the queued event, and inserts its job in one transaction.
It preserves the original request, delivery, and attempt history. Success returns
202 with `notificationId`, `deliveryId`, and `sourceDeliveryId`.

The immutable `delivery_redrives` audit stores the authenticated actor, reason,
source and successor delivery, and timestamp. Each source can be redriven once;
a terminal successor can start a further audited chain. Redrive explicitly allows
duplicates of earlier ambiguous sends.

Eligibility failures return 409 with `DELIVERY_REDRIVE_NOT_TERMINAL`,
`DELIVERY_ALREADY_REDRIVEN`, `DELIVERY_REDRIVE_ENDPOINT_INACTIVE`, or
`DELIVERY_REDRIVE_EXPIRY_INVALID`. Missing/foreign work returns 404
`DELIVERY_NOT_FOUND`. Admission rejects with 429 and `Retry-After`.

## Exhausted infrastructure jobs

The worker reconciles up to 100 retained failed provider jobs on startup and every
60 seconds. It checks persisted queue and delivery state under lifecycle locks,
records unfinished attempts as `ambiguous` with `DELIVERY_RECOVERY_EXHAUSTED`, and
commits a visible terminal outcome, event, and admission release. Reconciliation
performs no provider I/O and never reopens terminal work. Multiple workers may run
it safely. A still-runnable successor prevents an older failed job from failing its
chain.

Unresolved jobs retain infinite retention protection. Reconciled failed jobs switch
to 28-day retention so they do not block later batches. Apply the phase-24 database
migration before deploying either application.

## Verification

Use disposable PostgreSQL 18 and set `TEST_DELIVERY_DATABASE_URL` for
`packages/service/tests/recovery.integration.test.ts`. Retry floor, Retry-After,
jitter, expiry, and cap tests are in `delivery-policy.test.ts`. Built HTTP/OpenAPI
coverage is in the server's `submission.integration.test.ts`, enabled with
`TEST_AUTH_DATABASE_URL`.
