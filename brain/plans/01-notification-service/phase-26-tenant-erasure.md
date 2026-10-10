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

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Delete a tenant with pending work and a worker paused just after send-start reservation commit; resume/restart and verify the documented in-flight exception, no new reservations, remaining tenant access, and audit/backup retention.
- Behavioral scenarios: In-flight deletion; new submission denial; cross-tenant preservation; secret removal; bounded retention resume.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.

## Implementation status — 2026-10-10

Implemented locally: authorized organization/project/environment erasure receipts, recipient cleanup, resumable 100-record worker batches, grant revocation, secret scrubbing, and 30/7/90-day retention. Native organization writes share the lifecycle lock. Reserved sends have a two-minute deadline; late results cannot restore secrets or create retries. Recipient erasure cancels pending deliveries in shared notifications. Technical tombstones and bounded audit/replay records remain; backups, WAL, exports, and provider copies require separate operator handling. See `ERASURE.md`.

Verification: all 226 workspace tests passed without skips against PostgreSQL 18.6, including integration tests, provider protocol fixtures, built HTTP/OpenAPI tests, check/build/schema checks, and standalone worker startup/shutdown smoke. Cases cover reservation races, paused workers, late callbacks, cross-tenant preservation, batch resumption, auth revocation, retention, and event watermarks. Narrow worker-only database functions preserve ordinary write immutability.

Next: [[plans/01-notification-service/phase-27-observability]]. Live provider qualification remains open; provider consumers remain disabled.
