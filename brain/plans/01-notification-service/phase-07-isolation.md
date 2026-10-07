# Tenant transaction boundary

Back to [[plans/01-notification-service/overview]]

## Goal

Create the application ownership schema and tenant transaction gateway, with composite references and FORCE RLS. Separate auth/queue privilege paths from tenant-domain queries.

## Changes

- packages/database/src/tenancy/schema.ts
- packages/database/src/tenancy/index.ts
- packages/database/tests/persistence.integration.test.ts

- Database owns the internal table metadata and transaction gateway. `@pipong/database/tenancy` exports only the scope, transaction type, and gateway; later capabilities add concrete repositories.
- Tenant migrations run after foundation and auth migrations because projects reference auth organizations.
- No public operations are introduced in this phase. Authorization is phase 08; project/environment HTTP operations are phase 09.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- TenantScope, TenantTransaction

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Exercise two tenants using actual non-owner pooled roles and interleaved committed/rolled-back transactions.
- Behavioral scenarios: Missing context; pooled context reset; cross-scope read; cross-scope insert; nested ownership mismatch.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.

## Completion

- Implemented 2026-10-07 in `packages/database`; no public routes in this phase.
- Organization/project/environment scope validation, transaction-local context, composite ownership references, and FORCE RLS for both runtime roles.
- Verified with real PostgreSQL 18: missing context, scope-limited reads and writes, ownership rejection, successful commits, rollback, concurrent transactions, and one-connection pool reuse.
- `pnpm check`, migration consistency checks, all builds, and all 57 workspace tests passed, including built server integration suites.
- Clean and repeated deployment migrations and both built gateway entrypoints passed runtime smoke checks.
- Next: phase 08 establishes authority before callers enter tenant transactions.
