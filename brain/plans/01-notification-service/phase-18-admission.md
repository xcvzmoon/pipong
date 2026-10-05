# Distributed tenant admission

Back to [[plans/01-notification-service/overview]]

## Goal

Add PostgreSQL-backed atomic request/fanout/pending-work limits and measured distributed provider concurrency. Wire into acceptance before creating jobs; support shared noisy-tenant limits across replicas.

## Changes

- packages/service/src/limits.ts
- packages/service/src/schema/limits.ts
- tests/limits.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- AdmissionDecision, TenantBudget

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Load two API/two worker replicas with healthy and noisy tenants; observe limits, Retry-After and continued healthy progress.
- Behavioral scenarios: Counter race; idempotent replay accounting; backlog cap; global concurrency; noisy-tenant fairness.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
