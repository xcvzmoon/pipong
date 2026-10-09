# Durable transactional enqueue

Back to [[plans/01-notification-service/overview]]

## Goal

Provision provider queues and pg-boss producer/consumer settings. Use pinned transaction adapters for send/complete; isolate queue schema privileges and configure unfinished-work retention/recovery.

## Changes

- packages/database/src/delivery-queue.ts owns provider queue startup, transactional insertion/completion, and retention protection. Database owns the generated tenancy migration; workers never run migrations.
- packages/service/src/queue.ts validates identifier-only jobs and UUIDv7 queue IDs.
- packages/database/tests/persistence.integration.test.ts extends the existing disposable PostgreSQL lifecycle fixture.
- Worker startup shares its queue runtime with auth mail; API/operator producers do not supervise. Public notification submission remains phase 19, so this packet adds no HTTP operation.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- DeliveryJob, QueueRuntime

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Commit and roll back application writes plus enqueue against real PostgreSQL; inspect worker-visible jobs and intentional null/suppressed enqueue outcomes.
- Behavioral scenarios: Atomic commit; rollback; enqueue suppression; runtime migration denial; producer/worker lifecycle.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.

## Implementation and verification, 2026-10-09

- Implemented on `feat/durable-queue`; awaiting PR review and merge.
- Database provisions the three provider queues using pinned pg-boss 12.37.0. Producers do not supervise; workers share the queue runtime with auth mail. Runtime schema creation and migration remain disabled, and runtime queue DDL functions remain denied.
- Identifier-only enqueue uses the caller's Drizzle transaction. Null insertion throws and rolls back application writes. Queue IDs must be UUIDv7. Completion uses the fetched ID/retry count and validates exactly one affected row; stale claims roll back result writes.
- Enqueue sets `keep_until` to PostgreSQL infinity in the same transaction. Finished-job deletion is disabled so exhausted failures remain available to the later reconciler. Retention/erasure and provider outcome retry policy remain later phases.
- `pnpm install`, `pnpm check`, `pnpm build`, and `pnpm database check` passed. The full workspace suite passed all 106 tests with both database integration variables configured against a disposable PostgreSQL 18 UTF-8 cluster.
- Four added integration cases cover missing provisioning/startup cleanup; atomic enqueue, rollback, suppression, and input validation; claim-aware completion and result rollback; expired-claim recovery, rejection of a prior real claim, and unfinished/exhausted retention. Existing tests prove repeated migrations, role isolation, and runtime migration denial. Built auth worker tests verify startup, restart, mail delivery, and shutdown with the shared queue runtime.
- The first full run used an incorrectly initialized SQL_ASCII fixture and failed the existing Unicode recipient test. Recreating the disposable cluster with UTF-8 resolved that failure without product changes.
- Public notification submission remains phase 19; provider consumers remain disabled until their adapters are implemented. Next implementation is phase 17 ordered events.
