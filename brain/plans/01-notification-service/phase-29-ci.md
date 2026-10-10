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

## Implementation status

- Implemented locally, 2026-10-10. CI and tagged releases provision disposable PostgreSQL 18 UTF-8/trust fixtures and run `ops/check-ci.sh`: check, migration-history validation, both app builds, and sequential real-database/protocol/HTTP suites. Missing database configuration and empty server test selection fail.
- Added an earlier-schema upgrade scenario that preserves an existing organization and verifies idempotent completion. Fixed deployment roles are isolated by serial package/file execution on the disposable cluster.
- Both workflows build four versioned images and run `ops/check-images.sh`. The isolated TLS Compose installation verifies repeated migrations, non-root application images, operator bootstrap, API liveness, worker heartbeat publication, and graceful heartbeat removal. Cleanup removes the stack, volume, and generated secrets.
- Tagged releases publish verified images through the existing genbumppush Docker retry path before syncing the GitHub release. Image publication and release creation were not exercised locally.
- Local verification passed the exact CI sequence: 238 workspace tests without skips against PostgreSQL 18.6 UTF-8, check/build/migration-history gates, empty-test and missing-URL failure probes, all four image builds, and TLS image installation. A subsequent database run verified the upgrade cleanup change; its admission suite was omitted because only the persistence URL was set. Shell syntax, workflow YAML parsing, and diff whitespace checks passed.
- README documents gate commands and the Node 24 / pnpm 12.6.0 / PostgreSQL 18 / Bookworm runtime matrix. GitHub-hosted execution and registry publication remain unverified until this change runs remotely. Phase 30 must still qualify providers, load, restore, and the pinned framework/dependency matrix; consumers remain disabled.
