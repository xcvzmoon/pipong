# Commit-safe event ledger

Back to [[plans/01-notification-service/overview]]

## Goal

Implement environment counters held through commit, scoped replay cursors, retention watermark, and state/event atomicity. Establish this before enabling submissions or delivery state mutations in a public deployment.

## Changes

- packages/service/src/events.ts
- packages/service/src/schema/events.ts
- tests/events.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- DeliveryEvent, EventCursor, ReplayWatermark

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Intentionally invert transaction timing and read/replay events from a second process; no committed event disappears behind a cursor.
- Behavioral scenarios: Commit inversion; event rollback; wrong-stream cursor; pruned cursor; duplicate replay.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
