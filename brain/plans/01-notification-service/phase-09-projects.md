# Project/environment ownership

Back to [[plans/01-notification-service/overview]]

## Status

- Implemented and independently reviewed, 2026-10-07. Next: [[plans/01-notification-service/phase-10-service-keys]].
- Verified `pnpm check`, `pnpm database check`, `pnpm build`, and the full `pnpm test` suite with PostgreSQL 18. Integration suites used disposable databases; all 67 tests ran and passed.
- Built HTTP tests cover all twelve routes, generated OpenAPI request/response schemas, scoped names/cursors, ownership and role/MFA denial, duplicate-name races, suspension locks, and deletion gates.
- Public contract: `PROJECTS.md`. Database owns concrete repositories and the suspension/name/column-privilege migration; service owns policy and cursor contracts.
- Destructive deletion remains gated until phase 26. This phase does not certify the remaining notification delivery or production release gates.

## Goal

Implement project and environment creation/read/update/suspension with immutable organization ownership and tenant-safe lookup errors. Keep organization lifecycle destructive operations gated until erasure is implemented.

## Changes

- Project packet: `packages/database/src/projects/index.ts`, `packages/service/src/projects.ts`, and `packages/database/src/tenancy/schema.ts`.
- Environment packet: `packages/database/src/environments/index.ts`, `packages/service/src/environments.ts`, and shared validation/cursor contracts in `packages/service/src/resources.ts`.
- SQL and generated migrations stay in database. Concrete repositories accept the authorized tenant transaction; table metadata remains internal.
- Repeat the HTTP packet per operation under `apps/server/src/api/v1/organizations/[organizationId]/projects`; integration evidence is in `apps/server/tests/projects.integration.test.ts`.
- Include create/list/read/rename/suspend and authorized deletion gates. Bounded erasure remains phase 26 work.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- Project, Environment

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Exercise project/environment service operations against PostgreSQL under both organizations; adapters follow the mandatory HTTP packet below.
- Behavioral scenarios: Ownership mismatch; duplicate scoped name; suspension; sibling environment; cursor scope.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
