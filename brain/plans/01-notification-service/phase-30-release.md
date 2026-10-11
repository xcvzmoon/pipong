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

## Minimum VPS qualification packet, 2026-10-11

- User confirmed a VPS with at least 2 vCPU and 8 GB RAM. Treat this as the deployment target; it does not establish a supported request rate.
- Batched initial event/job writes preserve atomic acceptance, mixed-provider queue defaults, tenant groups, retention, contiguous cursors, and suppression rollback. Reduced admission and terminal-settlement round trips preserve budget serialization and claim fencing. All 41 database regressions passed after the settlement changes; independent review found no actionable issues.
- Raised the SSE process cap to 1,024 and deduplicated authorization only by complete principal within one environment poll. Functional tests cover exact capacity, slot reuse, selective session/key revocation, and delivery to surviving streams; per-environment limits and bounded writes remain.
- Added `ops/qualify-load.sh`: PostgreSQL, API2, consumer2 share one 2-CPU/8-GB cgroup with no swap; host driver/proxy/provider remain outside. Reports measure all backend PIDs, cgroup throttling/memory, database waits, request schedule lag, stream bytes, exact delivery counts, and revocation. Short runs are diagnostics; the 30-minute and intended-VPS gates remain open.
- Docker fixture startup fixes use loopback-published ports, disposable trust authentication, `localhost` auth origins, stdin configuration, and separately copied synthetic 0600 keyrings. No production authorization rules changed. The local Docker VM has about 3.82 GiB physical RAM, below the requested container ceiling; record that limit with results.

- Final validation passed `ops/check-ci.sh`: 254 routine tests, one opt-in load skip, both builds, schema checks, and `pnpm check`.
- Isolated 60-second backend-only 2-CPU run with 150,000 retained jobs failed: 2,991/3,000 accepted, nine 503 responses, acceptance p95 8.78 seconds, quiet/noisy dispatch about 36.2 seconds, and backlog at cutoff. All 1,000 SSE streams stayed live, received events, and passed revocation; generator lag stayed below 60 ms. Cgroup throttled in 69% of periods and peaked at 1.6865 GB. Reports `/tmp/pipong-enterprise-vps-short.json` and `.log`; sanitized durable results in `docs/release-evidence.md`.
- Intrusive profiling still found tenant-budget lock waits dominant (68.9 seconds over 2,838 selects; 18.2 seconds over 1,934 settlement calls); queue fetch averaged 0.15 ms, confirming the earlier index fix. Worker sample was 78% idle; API query processing is material. Inspector cleanup interrupted one diagnostic worker after sampling, so profiling timing cannot qualify performance. Preserve serialization/authentication boundaries while designing the next reduction in critical-section work; do not claim the requested VPS supports 50 requests/s.
- A later atomic stream-counter upsert comparison regressed to 1,973/3,000 accepted (1,027 responses with status 503), 8.78-second acceptance p95, and only 300/1,000 streams live after load. Reverted that optimization; keep batch insertion. No specific SQL failure cause was established. Reports `/tmp/pipong-enterprise-vps-final-short.json` and `.log`.
- Reverted comparison accepted all 3,000 sustained and 1,500 stream-load requests, completed all 8,500 deliveries, and kept all 1,000 streams live with revocation. Acceptance p95 692.4/351.7 ms and quiet/noisy dispatch 6,030/6,051 ms still failed latency gates. Burst drained in 8,058 ms; memory peak 1.5843 GB, no sampling failures. Reports `/tmp/pipong-enterprise-vps-reverted-short.json` and `.log`; retain separate stream initialization/update.
- The constrained workload uses one human session and an APNs-only consumer harness, not full worker services or many independent principals.
- Phase 30 remains open. Do not run or claim a 30-minute pass from this failed short diagnostic; qualify the actual VPS, full worker ancillary tasks, live devices, and registry artifacts separately.

## Budget profiling and Docker CPU affinity, 2026-10-11

- Profiled five 60-second Docker comparisons with 150,000 retained jobs. Tenant-budget locking remained the largest measured query cost; the quota-only baseline recorded 25.56 seconds over 4,437 calls. Statement totals include execution and waits, not direct lock-hold duration.
- Combined post-lock admission reads and update-first stream initialization reduced statements but did not establish overall latency gains. Reverted both application experiments. Retain the earlier admission/batching implementation.
- The eight-CPU Docker VM with a shared two-CPU quota throttled heavily. Added default CPU affinity `0,1` and effective CPU-set reporting. Pinned baseline throttled in only seven periods (3,569 microseconds), versus 997 periods (142.1 aggregate seconds) without affinity. Its budget locking snapshot was 10.15 seconds over 4,484 calls. CPU affinity is a test-topology improvement, not a production throughput guarantee.
- Final pinned baseline accepted all 4,500 requests, completed all 8,500 deliveries, and passed all 1,000-stream delivery/revocation checks. Sustained acceptance p95 785.6 ms, quiet/noisy dispatch 4,832.6/4,867.2 ms, and stream-load acceptance 278.0 ms still failed latency gates. Burst drained in 8,325 ms; four processes survived, no sampling failures, memory peak 1,699,106,816 bytes. Docker VM physical memory remains about 3.82 GiB.
- Added regression coverage for committed reservation/key reads after a budget-lock wait and concurrent initial stream batches with rollback and contiguous cursors. Extended only the multi-stage revocation test's outer timeout to 20 seconds; individual five-second revocation deadlines remain.
- Raw evidence `/tmp/pipong-budget-*.json`, `.log`, and normalized statement snapshots; durable summary in `docs/release-evidence.md`. All disposable containers were removed. Phase 30 remains open; do not substitute a 30-minute run for fixing failed short-run gates.
- Final validation passed `ops/check-ci.sh`: 256 routine tests, one intentionally skipped opt-in load case exercised separately, both deployable builds, migration-history checks, and `pnpm check`. No commits, pushes, or image publication.

## Local CPU and RAM qualification, 2026-10-11

- Host has eight logical CPUs and 8 GiB RAM; Docker VM exposes about 3.82 GiB RAM. Chose two CPUs pinned to `0,1`, hard 2 GiB memory, and no swap. Added matching BuildKit build-step limits and verified their cgroup settings. Host driver has a 256 MiB V8 heap ceiling and remains outside the backend cap.
- Corrected diagnostic captured private PostgreSQL transaction timings and ten-second API/consumer CPU profiles. Acceptance wall time averaged 40.07 ms versus 8.91 ms summed SQL durations; post-budget-statement completion to commit averaged 15.96 ms. Logging adds overhead, and those intervals are not exact lock-hold measurements. Consumer checkout p95 0.038 ms with idle connections; API checkout measurement unavailable. Raw SQL logs deleted after aggregation.
- Clean uninstrumented comparison accepted all 4,500 requests, completed all 8,500 deliveries, and passed all 1,000-stream checks. Acceptance p95 91.82 ms and stream-load acceptance 75.48 ms passed. Quiet/noisy dispatch p95 3,921.90/4,013.05 ms still failed the 2-second gate. Burst drained in 7,553 ms; backend peak 1,329,233,920 bytes (about 1.24 GiB), no sampling failures.
- No memory-limit or OOM events occurred; all four processes survived and disposable containers were removed. Evidence `/tmp/pipong-local-profile-transactions.json`, `/tmp/pipong-local-profile-summary.json`, and `/tmp/pipong-local-clean.json` with run logs. Phase 30 remains open for dispatch latency, the 30-minute intended-VPS run, full workers, independent principals, live devices, recovery, and publication.

## Dispatch claim round trip, 2026-10-11

- Retained a single-statement provider-budget/active-count read after the provider advisory lock. One fewer database round trip per claim; counts include ungrouped jobs, and concurrency limits and sequential send behavior remain unchanged.
- Same 2 CPU/2 GiB/no-swap workload accepted all 4,500 requests and completed all 8,500 deliveries. Acceptance p95 75.13 ms, stream acceptance 138.47 ms, all 1,000-stream delivery/revocation checks passed. Quiet/noisy dispatch improved about 36–37% to 2,517.1/2,518.0 ms, still above the 2-second gate. Burst drained in 7,586 ms; memory peak 1,270,591,488 bytes, no memory-limit/OOM events or sampling failures.
- Removed all parallel-send experiments. APNs has a single-send busy guard; concurrent consumers can produce ambiguous `DELIVERY_SENDER_FAILED` outcomes. A tested transport correction removed those failures but increased contention still regressed acceptance and dispatch under two CPUs. Do not increase consumer concurrency without qualifying the transport and complete workload together.
- Reports `/tmp/pipong-dispatch-{four,two,multiplex,claim}.json` and logs. Phase 30 remains open; the final retained implementation uses sequential consumers.
- Final retained implementation passed `ops/check-ci.sh`: 256 routine tests, both builds, migration-history checks, and `pnpm check`. The opt-in load case was exercised separately. No commits, pushes, or publication.

## Revised local device target, 2026-10-11

- Current target, 2026-10-11: user replaced the VPS target with this Apple M1 device (eight CPU cores, 8 GiB RAM, arm64). Use a two-CPU, 2 GiB, no-swap Docker backend budget, with host driver/proxy/provider outside it. Docker is currently stopped; recheck its allocation before running. Historical VPS measurements retain their original limits. Dispatch p95 remains 2.52 seconds against the unchanged 2-second gate; the 30-minute local-device run and remaining release gates are open.

- Local capacity discovery, 2026-10-11: the 60-second 50-request/s stress run failed acceptance/dispatch latency but completed all 8,500 deliveries and 1,000-stream checks. At 25 requests/s, the same two-CPU/2-GiB budget passed all existing checks: acceptance p95 31.44 ms, sustained dispatch p95 about 1 second, 4,750 completed deliveries, and 1,000 live/revocable streams. Burst drain was 7.56 seconds; the sustained 2-second gate does not cover burst latency. Candidate workload is 25 requests/s and 1,000 streams pending a 30-minute run. See `docs/release-evidence.md`; full workers, independent principals, live devices, recovery, and publication remain open.

- Full local qualification, 2026-10-11: 30 minutes at 25 requests/s passed within two CPUs/2 GiB/no swap. All 45,000 sustained requests returned 202, acceptance p95 was 18.77 ms, sustained quiet/noisy dispatch p95 was 960.05/959.00 ms, and all 91,750 deliveries completed. The separate 30-second 1,000-stream phase passed delivery/revocation with acceptance p95 30.50 ms. Burst drain was 7.05 seconds; backend peak memory was 1.71 GiB. This closes the local harness 30-minute gate, not 30-minute SSE/full-worker/live-provider qualification. See `docs/release-evidence.md`; remaining release gates stay open.

- Full-worker qualification packet, 2026-10-11: production entrypoint and load fixture now share the built worker lifecycle, with only the local TLS APNs connection supplied by the fixture. Two workers run all four consumers plus heartbeat, retention, recovery, and erasure scans. A 60-second 25-request/s, 1,000-stream run passed within two CPUs/2 GiB, including readiness, audit pruning, and graceful shutdown. The 30-minute full-worker run is launched; sustained SSE, independent principals, live providers, recovery, and publication remain open.

- Full-worker 30-minute qualification passed, 2026-10-11: two built workers and two API replicas shared two CPUs/2 GiB/no swap at 25 requests/s. All 45,000 sustained requests returned 202; acceptance p95 was 18.99 ms, quiet/noisy sustained dispatch p95 was 966.05/958.00 ms, and all 91,750 deliveries completed. The subsequent 1,000-stream phase passed delivery/revocation; backend peak was 1.60 GiB. All-consumer readiness, startup/periodic audit pruning, and graceful shutdown checks passed. APNs used a local TLS fixture; other consumers were idle. Independent principals, sustained SSE, mixed-provider/live-device load, deployment recovery, and publication remain open. See `docs/release-evidence.md`.

- Sustained SSE 30-minute qualification passed, 2026-10-11: two API replicas and two full workers shared two CPU cores/2 GiB/no swap at 25 requests/s. All 45,000 sustained requests returned 202 and all 92,502 deliveries completed; acceptance p95 was 26.13 ms and maximum stream-environment dispatch p95 was 984 ms. All 1,000 streams held by twenty human sessions and twenty service keys remained live and ordered throughout. Exactly 50 revoked connections closed within 548 ms; 950 unaffected streams continued, revoked reconnects were denied, and cursor replay passed. Peak memory was 1.65 GiB; maintenance and graceful shutdown passed. Mixed-provider/live-device load, deployment recovery, and publication remain open. See `docs/release-evidence.md`.

- Mixed-provider 30-minute qualification passed, 2026-10-11: two API replicas, two full workers, and PostgreSQL shared two CPU cores/2 GiB/no swap at 15 requests/s. All 27,000 sustained requests returned 202 and all 55,902 APNs/FCM/Web Push deliveries completed without retries or transport failures. Acceptance p95 was 34.56 ms; provider initial dispatch p95 was 963/962/957 ms. All 1,000 streams stayed live for 30 minutes across forty session/key principals; exactly 50 revoked connections closed in 1,024 ms, 950 continued, and replay passed. FCM refreshed tokens during sustained traffic. Peak backend memory was 1.49 GiB. Maintenance and graceful shutdown passed; disposable resources were removed. Provider fixtures ran outside the backend cap in a separate Linux container. This verifies a workload, not a capacity ceiling; live-provider/device, deployment recovery, and publication gates remain open. See `docs/release-evidence.md`.
