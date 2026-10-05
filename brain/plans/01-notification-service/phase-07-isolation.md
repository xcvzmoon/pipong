# Tenant transaction boundary

Back to [[plans/01-notification-service/overview]]

## Goal

Create the application ownership schema and tenant transaction gateway, with composite references and FORCE RLS. Separate auth/queue privilege paths from tenant-domain queries.

## Changes

- packages/service/src/schema/tenancy.ts
- packages/service/src/tenant-transaction.ts
- tests/isolation.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- TenantScope, TenantTransaction

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Exercise two tenants using actual non-owner pooled roles and interleaved committed/rolled-back transactions.
- Behavioral scenarios: Missing context; pooled context reset; cross-scope read; cross-scope insert; nested ownership mismatch.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
