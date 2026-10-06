# Controlled PostgreSQL lifecycle

Back to [[plans/01-notification-service/overview]]

## Status

- Implemented in `packages/database`. The API and worker call `useApiDb()` or `useWorkerDb()`; only database reads their environment settings.
- `env.ts` validates values using the existing environment library and shared boolean schema. `clients.ts` maps validated values into PostgreSQL pool options, checks runtime privileges, and drains connections.
- Settings match `packages/database/.env.example`: role-specific URLs, maximum pools, timeouts, application names, and per-role query-logger flags.
- Drizzle Kit now owns migrations through `drizzle.migrate.config.ts`. API/worker configs share schemas and history but select different credentials. The custom runner and standalone migration artifact are removed; deployment must serialize migration jobs.
- Administrator provisioning creates restricted runtime logins and a separate migrator. The existing foundation migration has a Drizzle snapshot matching its schemas.
- See [[plans/01-notification-service/database-ownership]] for the package boundary and future persistence ownership.

## Goal

Add bounded node-postgres/Drizzle pools and a one-shot migration command. Establish auth/application/queue schema privileges and role ownership without runtime DDL.

## Changes

- packages/database/src/index.ts, src/clients.ts, src/env.ts, src/schema.ts
- packages/database/drizzle.*.config.ts
- packages/database/tests/database.integration.test.ts

- Integration: API plugin, worker startup/build, app manifests, database manifests/configuration, provision SQL and foundation migration.
- Operator documentation: CONFIGURATION.md and README.md.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- DatabaseRuntime

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Migrate a clean PostgreSQL instance, run a real transaction under each runtime role, and stop processes without leaked connections.
- Behavioral scenarios: Clean migration; repeat migration; rollback; forbidden runtime DDL; pool shutdown.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
