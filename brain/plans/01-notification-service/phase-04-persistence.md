# Controlled PostgreSQL lifecycle

Back to [[plans/01-notification-service/overview]]

## Status

- Implemented 2026-10-06 in `packages/database`, using the existing workspace package.
- API and worker apply independent pool budgets, verify runtime privileges at startup, and drain connections on shutdown.
- Administrator provisioning creates separate login roles. The one-shot worker migration artifact owns schema DDL; app startup never runs migrations.
- Verified against a temporary PostgreSQL 18 instance: clean/repeated migration, SQL rollback, schema grants, denied runtime DDL, pool bounds, shutdown, and rejected privileged identities. Packaged API/worker/migration artifacts also passed startup and SIGTERM checks outside the source checkout, with no remaining database connections.

## Goal

Add bounded node-postgres/Drizzle pools and a one-shot migration command. Establish auth/application/queue schema privileges and role ownership without runtime DDL.

## Changes

- packages/database/src/index.ts, src/migrate.ts, src/env.ts
- apps/worker/src/migrate.ts
- packages/database/tests/database.integration.test.ts

- Integration: API plugin, worker startup/build, app manifests, database manifests/configuration, provision SQL and foundation migration.
- Operator documentation: CONFIGURATION.md and README.md.

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
