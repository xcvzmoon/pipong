# Fenced delivery execution

Back to [[plans/01-notification-service/overview]]

## Goal

Reserve logical send-start under locks shared with cancel/disable/suspend, record one fenced attempt, release before network I/O, and finalize state/event/successor with claim-aware settlement. Track pg-boss id+retryCount separately from application attempt generation; affected count other than one rolls back all writes. A recovered terminal delivery is not resent.

## Changes

- packages/service/src/delivery.ts
- packages/service/src/attempts.ts
- tests/delivery.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- DeliveryAttempt, AttemptFence, QueueClaim, SendReservation, ProviderOutcome

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Run two workers with a local transport fixture; reclaim a job before its replacement application attempt starts, then settle the old worker. Also pause after reservation commit and issue cancellation/disable/suspension before network I/O.
- Behavioral scenarios: Competing claims; post-acceptance crash; lost-claim settlement rollback; terminal recovery; send-reservation/cancel ordering without a network-held transaction.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
