# Automated integration gates

Back to [[plans/01-notification-service/overview]]

## Goal

Extend existing CI/release to PostgreSQL-backed tests, apps/server and apps/worker builds, schema upgrade checks, and versioned image verification. Root commands orchestrate both apps; artifact paths use apps/server/.output and the independent worker output. Remove no-test success and isolate stateful fixtures.

## Changes

- vitest.config.ts
- .github/workflows/ci.yaml
- .github/workflows/release.yaml

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- CompatibilityMatrix, ReleaseArtifact

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Run the exact CI command sequence locally and test installation of produced artifacts; release does not bypass tests.
- Behavioral scenarios: Real database suite; empty/upgrade schema; API/worker build; production image; fail on missing tests.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
