# Suspension and data erasure

Back to [[plans/01-notification-service/overview]]

## Goal

Implement bounded tenant/project/recipient deletion after suspension, prevent new logical send-start reservations, cancel pending work, remove secret data and invalidate auth grants. Already reserved work is in-flight; settle or abandon it within a bound without restoring erased secrets. Integrate all organization deletion entrypoints.

## Changes

- packages/service/src/erasure.ts
- apps/worker/src/retention.ts
- tests/erasure.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- ErasureJob, RetentionPolicy

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Delete a tenant with pending work and a worker paused just after send-start reservation commit; resume/restart and verify the documented in-flight exception, no new reservations, remaining tenant access, and audit/backup retention.
- Behavioral scenarios: In-flight deletion; new submission denial; cross-tenant preservation; secret removal; bounded retention resume.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
