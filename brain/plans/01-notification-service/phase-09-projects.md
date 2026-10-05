# Project/environment ownership

Back to [[plans/01-notification-service/overview]]

## Goal

Implement project and environment creation/read/update/suspension with immutable organization ownership and tenant-safe lookup errors. Keep organization lifecycle destructive operations gated until erasure is implemented.

## Changes

- packages/service/src/projects.ts
- packages/service/src/schema/projects.ts
- tests/projects.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- Project, Environment

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Exercise project/environment service operations against PostgreSQL under both organizations; adapters follow the mandatory HTTP packet below.
- Behavioral scenarios: Ownership mismatch; duplicate scoped name; suspension; sibling environment; cursor scope.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
