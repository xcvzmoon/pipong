# Validated runtime configuration

Back to [[plans/01-notification-service/overview]]

## Goal

Introduce explicit Node preset, Nitro serverDir ./src and source-aligned aliases, and Valibot-validated API/worker configuration, including independent pool budgets, encryption keyring references, canonical auth URL, and supported provider settings.

## Changes

- apps/server/nitro.config.ts
- packages/service/src/config.ts
- tests/config.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- ApiConfig, WorkerConfig

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Run each entrypoint with valid and invalid environment settings; failures have stable codes and no secret leakage.
- Behavioral scenarios: Missing required secret; malformed URL; invalid budgets; environment override; redacted error.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
