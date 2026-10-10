# Release qualification

Back to [[plans/01-notification-service/overview]]

## Goal

Rehearse backup+key restoration, measured load/fairness/SSE envelope, provider device matrix and incident runbooks. Publish only exercised support claims and explicit provider prerequisites.

## Changes

- docs/operations.md
- docs/release-evidence.md
- tests/release-smoke.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- ReleaseEvidence, SupportedEnvelope

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Run the complete clean-install/real-provider/restore/load matrix from verification; all gates required before production designation.
- Behavioral scenarios: Restore RPO/RTO; benchmark envelope; real provider matrix; compromised-key response; complete contract coverage.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.

## Implementation status

- Started locally, 2026-10-10. Added `docs/operations.md` and `docs/release-evidence.md` with recovery/credential incident procedures and explicit unqualified provider, restore, load, fairness, SSE, and published-artifact gates.
- Added `packages/service/tests/release-smoke.integration.test.ts`: PostgreSQL custom-format dump into an empty database, repeated migrations, separately backed-up credential key restoration, absent-key and changed-tenant denial, and restored runtime RLS/DDL restrictions. Database-level grants require separate provisioning because the dump does not carry destination database privileges.
- CI service tests and release gates install PostgreSQL 18 client tools for this rehearsal. Hosted execution remains unverified.
- Phase 30 remains open. Delivery consumers are disabled; no end-to-end dispatch benchmark, live device matrix, full-stack recovery, production RPO/RTO, or supported capacity claim is established.
- Local verification passed `ops/check-ci.sh` against PostgreSQL 18.6: 239 tests without skips, both deployable builds, migration-history checks, and `pnpm check`. A redundant overlapping restore invocation failed on fixed roles; the serialized CI run passed. Stateful suites must retain dedicated-cluster serialization.
- Added the built API/worker recovery packet, 2026-10-10: restore into an empty database with a separate key backup; recover human sessions, revoked service keys, canonical idempotency, pending jobs, exhausted ambiguous attempts, HTTP/SSE replay, and recipient erasure across worker restarts. A post-snapshot acceptance is deliberately absent after recovery.
- Extended `ops/check-images.sh` to remove its disposable database volume, restore database and separately backed-up secrets on a clean installation, repeat migrations, and verify recovered API liveness and worker leases. Existing `ci-local-phase29` images passed; recovery took about 21 seconds with a conservative snapshot loss window of at most one second. Image IDs and topology are recorded in `docs/release-evidence.md`.
- These drills cover the current runtime with push consumers disabled. Active provider sends/queue leases, post-snapshot revocation and erasure reconciliation, WAL recovery, and deployment-specific RPO/RTO remain open. Phase 30 remains incomplete.
- Recovery-packet verification passed `ops/check-ci.sh` against PostgreSQL 18.6: 240 tests without skips, both deployable builds, migration-history checks, and `pnpm check`. The final standalone runtime rehearsal recovered in 5,806 ms with a conservative 114 ms snapshot loss window. The clean-volume image gate passed separately; no images were rebuilt or published.

## Worker consumer integration packet, 2026-10-11

- Primary files: `packages/service/src/delivery-consumer.ts`, `apps/worker/src/index.ts`, and `packages/shared/src/config.ts`; queue timeouts, telemetry, tests, and operator docs support this lifecycle.
- Added explicit `PUSH_DELIVERY_ENABLED=true` activation with a required `WEB_PUSH_SUBJECT`. Default installations keep push disabled; activation is for qualification until the remaining release gates pass.
- Each worker runs one sequential send per provider through database-wide/tenant admission, committed send reservation, provider-specific atomic settlement, and bounded retries. Keyrings reload before claims; sender exceptions settle as ambiguous; lost claims leave results uncommitted for recovery.
- SIGINT/SIGTERM stop new polling and drain current sends before provider clients, queue, and database close. Started consumers join the independent heartbeat; readiness requires all consumer leases.
- Seven real PostgreSQL consumer scenarios cover provider dispatch, abort drain, thrown send retry, canceled work, keyring outage/repair, and stale-claim rollback. Built worker verification covers ready leases and graceful exit.
- Phase 30 remains open for deterministic sustained/burst/fairness/SSE measurement, active-send recovery, post-snapshot incident reconciliation, WAL/deployment recovery, live devices, and published artifacts. Consumer activation does not establish these claims.
- Final verification passed `CI_DATABASE_URL=<disposable PostgreSQL 18.6 cluster> sh ops/check-ci.sh`: 249 tests without skips, both app builds, migration-history checks, and `pnpm check`. The first run caught a new readiness test querying the wrong heartbeat column; the corrected full rerun passed. The enabled built worker became ready and exited with code 0 on SIGTERM. No images were rebuilt or published.

## Delivery bottleneck investigation, 2026-10-11

- The 30-minute controlled run accepted 90,000 requests but failed dispatch p95, burst drain, and 1,000-stream capacity. Dispatch reached about 430 seconds; two API replicas admitted 512 streams. Phase 30 remains open.
- Profiling with 150,000 synthetic retained queue jobs found the global active-claim count scanning completed history on every claim: 189 seconds of database time versus 1.9 seconds for pg-boss fetches. The existing active-group index cannot satisfy a count that includes ungrouped jobs.
- Added the `delivery_active_claims` custom migration with a queue-name partial index for every active job. The count now uses four database blocks and averaged about 0.009 ms in the follow-up run. A 50,000-row history regression failed before the migration and passed after it; ungrouped active jobs still consume global capacity.
- The qualification harness can preload retained jobs through `QUALIFICATION_RETAINED_JOBS`. Tenant-budget row-lock contention is the largest remaining measured database wait. A shorter controlled run does not close the 30-minute deployment gate.
- The 180-second follow-up with 150,000 retained jobs sent all 19,000 deliveries. Quiet/noisy dispatch p95 improved from about 39 seconds to 6.9/7.0 seconds; burst drain improved from 47.2 to 7.6 seconds. Acceptance p95 rose to 945.6 ms while workers competed with admission for the tenant-budget row. Both latency gates remain failed. Other workstation activity and static checks overlapped this diagnostic run; these numbers are not an isolated capacity claim.
- Publication verification passed the complete local integration gate: 250 routine tests, one intentionally skipped opt-in load test, both app builds, schema checks, and `pnpm check`. Rebuilt local images passed TLS installation and clean-volume restore (about 27 seconds); the physical WAL drill passed (634 ms recovery, 305 ms conservative target loss window). Live-device, intended-deployment, registry publication, and performance gates remain open.
