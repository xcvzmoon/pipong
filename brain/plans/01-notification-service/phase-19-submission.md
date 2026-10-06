# Atomic idempotent acceptance

Back to [[plans/01-notification-service/overview]]

## Goal

Persist immutable notification and deduplicated delivery snapshot, reserve quota/idempotency, append acceptance event, and enqueue jobs in one transaction. Return the same committed response on concurrent same-key requests.

## Changes

- packages/service/src/submit-notification.ts
- packages/service/src/schema/delivery.ts
- tests/submission.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- Notification, Delivery, IdempotencyRecord

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Race submissions over HTTP once its packet is integrated; kill/rollback at acceptance boundaries and inspect exact ledger/job cardinality.
- Behavioral scenarios: Concurrent duplicate; fingerprint conflict; enqueue rollback; no active targets; expired idempotency window.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
