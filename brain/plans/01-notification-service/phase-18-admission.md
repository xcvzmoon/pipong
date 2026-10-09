# Distributed tenant admission

Back to [[plans/01-notification-service/overview]]

## Status

- Started 2026-10-09 on `feat/distributed-admission`, from `main` after phase 17 merged in PR #23.
- Admission accounting and provider claim limits implemented locally. HTTP acceptance and fenced delivery integration belong to phases 19 and 20; their runtime gates remain pending.
- Publication separates admission accounting, provider claiming, operator documentation, and phase evidence into focused commits. Admission and provider policy have separate migrations.

## Goal

Add PostgreSQL-backed atomic request/fanout/pending-work limits and measured distributed provider concurrency. Wire into acceptance before creating jobs; support shared noisy-tenant limits across replicas.

## Changes

- Admission packet: packages/service/src/limits.ts, packages/database/src/limits.ts, packages/database/src/limits-schema.ts, following [[plans/01-notification-service/database-ownership]].
- Provider claim packet: packages/database/src/delivery-queue.ts, using the provider policy from the admission schema.
- Both packets: packages/database/tests/limits.integration.test.ts; service validation is exercised through child processes to keep database build declarations within the package.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- AdmissionDecision, TenantBudget

## Implementation boundaries

- Persist admission counters and provider policy in `packages/database`; expose validated decisions through `packages/service`.
- Reserve request, accepted-endpoint, and pending-work budgets in the authorized transaction before queue insertion. Rollback must restore every reservation.
- Serialize shared organization/key budgets across API replicas. Replayed acceptance must not charge fanout or pending work again; integrate that accounting with phase 19 idempotency.
- Bound active provider claims across worker replicas with pg-boss organization groups and a serialized provider fetch. Tenant caps leave capacity for healthy tenants. Phase 20 must fence stale attempts and bound transport deadlines before enabling consumers.
- Return stable rejection codes and retry timing for HTTP 429 with `Retry-After`. Public acceptance belongs to phase 19; do not expose a quota-only acceptance endpoint.
- Verify database races and rollback first, then integrate acceptance and attempt consumers in their dependent phases. The two-API/two-worker runtime gate remains required before claiming end-to-end enforcement.

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Load two API/two worker replicas with healthy and noisy tenants; observe limits, Retry-After and continued healthy progress.
- Behavioral scenarios: Counter race; idempotent replay accounting; backlog cap; global concurrency; noisy-tenant fairness.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.

## Local evidence, 2026-10-09

- PostgreSQL 18.6 UTF-8 disposable clusters; five admission scenarios passed, including two API child processes and two worker child processes sharing persisted limits.
- Request/key/fanout window caps, pending capacity across rollover, replay request charging without duplicate work, enqueue rollback, idempotent release, global claim caps, noisy-tenant fairness, input validation, and runtime policy mutation denial passed.
- `pnpm install`, `pnpm check`, `pnpm build`, and `pnpm database check` passed. Publication validation passed 111 workspace tests with PostgreSQL integration enabled and the five admission tests on a separate cluster. Both migrations were applied to clean databases; the admission-only intermediate commit passed its four scenarios.
- Defaults and transaction ownership documented in `ADMISSION.md`. No submission endpoint or provider consumer was added. HTTP 429/Retry-After and live provider traffic remain dependent integration gates, not verified behavior in this increment.
