# Atomic idempotent acceptance

Back to [[plans/01-notification-service/overview]]

## Status

- Implemented on `feat/atomic-notification-submission`, 2026-10-09; merged in PR #25.
- POST acceptance persists immutable requests and generation-bound deliveries, reserves admission, records queued events, and enqueues identifier-only jobs in one authorized transaction.
- Environment-scoped seven-day idempotency replay returns the original response, including after notification expiry; canonical fingerprints reject changed requests. HTTP 202/Location, 429/Retry-After, and strict streaming body limits are integrated with OpenAPI.
- Verified against disposable PostgreSQL 18 UTF-8 clusters: all 121 workspace tests passed, including five built HTTP scenarios covering duplicate races, canonical/expired replay, payload/expansion bounds, enqueue rollback, admission, live authority, FORCE RLS, and immutable content.
- `pnpm install`, `pnpm check`, `pnpm build`, and `pnpm database check` passed. Clean migration and repeated migration history checks passed.
- Database ownership follows [[plans/01-notification-service/database-ownership]]; schema/repositories live in packages/database. Existing endpoint truncation and migration-count fixtures include the new tables/migration.
- Next is phase 20 fenced attempts. Provider consumers, notification summary/inspection, and cancellation remain later packets.

## Goal

Persist immutable notification and deduplicated delivery snapshot, reserve quota/idempotency, append acceptance event, and enqueue jobs in one transaction. Return the same committed response on concurrent same-key requests.

## Changes

- packages/service/src/submit-notification.ts
- packages/database/src/submission-schema.ts
- packages/database/src/submission.ts

HTTP packet: the concrete notifications POST route, apps/server/tests/submission.integration.test.ts, and route OpenAPI metadata.

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
