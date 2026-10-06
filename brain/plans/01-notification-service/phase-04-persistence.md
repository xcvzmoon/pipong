# Controlled PostgreSQL lifecycle

Back to [[plans/01-notification-service/overview]]

## Goal

Add bounded node-postgres/Drizzle pools and a one-shot migration command. Establish auth/application/queue schema privileges and role ownership without runtime DDL.

## Changes

- packages/service/src/database.ts
- apps/worker/src/migrate.ts
- tests/database.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- DatabaseRuntime, MigrationResult

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Migrate a clean PostgreSQL instance, run a real transaction under each runtime role, and stop processes without leaked connections.
- Behavioral scenarios: Clean migration; repeat migration; rollback; forbidden runtime DDL; pool shutdown.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
