# Commit-safe event ledger

Back to [[plans/01-notification-service/overview]]

## Implementation status

- Implemented locally on `feat/ordered-events`, 2026-10-09; changes await PR review and merge.
- Database owns `events.ts`, `events-schema.ts`, and the generated tenancy migration. Service exports validated append and replay operations; the Nitro GET events route includes its OpenAPI contract.
- Environment counter locks last through commit. State/event rollback, scoped cursors, duplicate replay, seven-day prefix pruning, and atomic retention watermarks are implemented.
- Runtime accounts cannot update event history; API credentials cannot delete events or update retention watermarks. FORCE RLS requires the complete environment context.
- Verification: `pnpm install`, `pnpm check`, `pnpm build`, `pnpm database check`, and schema regeneration passed. All 111 workspace tests passed with both PostgreSQL integration URLs configured against a disposable PostgreSQL 18 UTF-8 cluster.
- Five event scenarios use a separate worker process and built Nitro HTTP/OpenAPI validation: inverted transaction timing, state/event rollback, wrong/malformed/future cursors, pruning/duplicate replay, and live human/service-key authority plus RLS/history mutation denial.
- Operator/client contract: `EVENTS.md`. SSE connection management remains phase 25; automatic retention scheduling remains lifecycle work. Public submission and delivery consumers remain disabled pending later phases.
- Next implementation: phase 18 distributed admission.

## Goal

Implement environment counters held through commit, scoped replay cursors, retention watermark, and state/event atomicity. Establish this before enabling submissions or delivery state mutations in a public deployment.

## Changes

- packages/service/src/events.ts
- packages/database/src/events-schema.ts and events.ts
- apps/server/tests/events.integration.test.ts and the Nitro events replay route

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
