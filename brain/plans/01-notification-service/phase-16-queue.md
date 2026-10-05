# Durable transactional enqueue

Back to [[plans/01-notification-service/overview]]

## Goal

Provision provider queues and pg-boss producer/consumer settings. Use pinned transaction adapters for send/complete; isolate queue schema privileges and configure unfinished-work retention/recovery.

## Changes

- packages/service/src/queue.ts
- apps/worker/src/queue-migrate.ts
- tests/queue.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- DeliveryJob, QueueRuntime

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Commit and roll back application writes plus enqueue against real PostgreSQL; inspect worker-visible jobs and intentional null/suppressed enqueue outcomes.
- Behavioral scenarios: Atomic commit; rollback; enqueue suppression; runtime migration denial; producer/worker lifecycle.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
