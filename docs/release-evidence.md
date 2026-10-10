# Release qualification evidence

Status on 2026-10-11: internal integration only. Production qualification is open.
Push consumers default to disabled; full readiness requires their fresh leases. No measured capacity,
availability SLA, provider display guarantee, or production RPO/RTO is published.

## Exercised boundaries

| Gate                 | Evidence                                                                                                                                                                                                                                                                                                                                   | Limit                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database/key restore | `packages/service/tests/release-smoke.integration.test.ts`: actual PostgreSQL 18 dump/restore, repeat migrations, credential decryption, absent-key denial, changed-tenant authentication failure, runtime RLS and DDL denial                                                                                                              | Small synthetic fixture; no full API/worker recovery, historical erasure reconciliation, WAL recovery, or production RPO/RTO                                          |
| Runtime restore      | `apps/server/tests/restore.integration.test.ts`: built API/worker against an empty restored database, separate key backup, sessions, revoked keys, idempotency, pending jobs, ambiguous exhausted attempts, SSE replay, and resumable recipient erasure; `ops/check-images.sh`: clean-volume image restore and recovered API/worker leases | Small synthetic fixtures with disabled push consumers; post-snapshot incident reconciliation, active provider sends, WAL recovery, and production RPO/RTO remain open |
| Provider protocols   | APNs, FCM, Web Push integration suites                                                                                                                                                                                                                                                                                                     | Controlled protocol fixtures; no physical device/browser qualification                                                                                                |
| HTTP/SSE             | Built HTTP observation and TLS stream suites                                                                                                                                                                                                                                                                                               | Functional coverage; no 1,000-client capacity evidence                                                                                                                |
| Installation and CI  | Phase 28/29 local four-image TLS installation and 238-test evidence                                                                                                                                                                                                                                                                        | Hosted gates and image checks passed for v0.0.6; registry write permission and installation from published artifacts remain open                                      |

Run `ops/check-ci.sh` against a dedicated disposable PostgreSQL 18 cluster.
The restore test additionally requires PostgreSQL 18 client binaries on PATH.
The current CI image gate does not replace the following manual gates.

Local validation on 2026-10-10 passed `ops/check-ci.sh` against PostgreSQL 18.6:
239 tests without skips, both deployable builds, migration-history checks, lint,
formatting, and typechecks. This run did not rebuild or republish container images.

## Local recovery rehearsal, 2026-10-10

Codex ran the recovery packet against baseline `c5b78d4` plus the uncommitted
restore tests and image-gate changes. The lockfile SHA-256 was
`4ae65ae6b66e95e9bab4b509f1c23a8af7fd53d824d04439829aa40338a4b4e6`.
The host used Node 24.21.0, pnpm 12.6.0, PostgreSQL 18.6, and Nitro
3.0.260903-beta on macOS arm64. The runtime test used one API, one worker,
and a dedicated trust-authenticated local PostgreSQL cluster.

The clean-volume gate used the existing `ci-local-phase29` images, one API,
one worker, and the Compose PostgreSQL database with verified TLS database
connections. The host API probe used loopback HTTP. Local image IDs were:

- Server: `sha256:518e3abb132cd2939ac8431170d3e219c1ae88bae0a92c052404d2d9a5f72e47`.
- Worker: `sha256:5e232eee5968374da41341751c04f7181a51a9fed1a5691ce3ff0495fc4fc4a5`.
- Migrator: `sha256:1a72a836031fe189935840f774a9e51c0cddc03c009baf7a581b721d79f8dd89`.
- Database: `sha256:8bc4689f3a6257dfcb7251e36127d8ce894764e1639f9b9db16a4cbe0e312f21`.

`PIPONG_VERSION=ci-local-phase29 sh ops/check-images.sh` passed. Recovery from
removing the disposable volume through API liveness and a fresh worker lease
took about 21 seconds. The conservative snapshot loss window was at most one
second. The original organization survived; the deliberate post-backup
organization did not. Secrets came from a separate backup, and migrations
passed after restoration. These are local image IDs, not published registry
digests or production recovery guarantees.

The final runtime run recovered in 5,806 ms with a conservative 114 ms snapshot
loss window and one absent post-snapshot acceptance. The runtime test restarts
the worker between bounded erasure batches and checks completion and recipient
identity removal. The fixture contains two backed-up notifications, one pending
delivery, and one exhausted send attempt. Push consumers remain disabled.

`CI_DATABASE_URL=<dedicated cluster> sh ops/check-ci.sh` passed with 240 tests
and no skips, both deployable builds, migration-history checks, and `pnpm check`.
The final standalone runtime rehearsal also passed. Images were exercised using
the local IDs above; this packet did not rebuild or publish them.

## Worker consumer integration, 2026-10-11

`PUSH_DELIVERY_ENABLED=true` starts all three provider consumers and requires
`WEB_PUSH_SUBJECT`. The default remains disabled. Each worker sends one delivery
at a time per provider through global/tenant admission, committed attempt fences,
and provider-specific result settlement. Shutdown drains the fetched claim.

`packages/service/tests/delivery-consumer.integration.test.ts` exercises real
PostgreSQL claims with controlled sender outcomes, including ambiguity, claim
loss, cancellation, keyring outage/repair, and graceful drain. The built worker
in `apps/server/tests/telemetry.integration.test.ts` publishes all consumer leases,
becomes ready, and removes its lease on graceful exit. These checks establish
consumer wiring and lifecycle; they do not measure dispatch capacity or certify
physical device delivery.

The local packet uses commit `199b760612f59bcdaca7ae064ec4c403104cfaa9` plus
uncommitted consumer changes and lockfile SHA-256
`4ae65ae6b66e95e9bab4b509f1c23a8af7fd53d824d04439829aa40338a4b4e6`.
Codex ran Node 24.21.0, pnpm 12.6.0, PostgreSQL 18.6, and Nitro
3.0.260903-beta on macOS arm64 with a disposable trust-authenticated database,
one built API, and one built worker. Controlled sender outcomes exercised the
queue boundary; existing protocol suites exercised transport. No Docker images
were rebuilt or published for this packet.

`CI_DATABASE_URL=<disposable PostgreSQL 18.6 cluster> sh ops/check-ci.sh` passed
249 tests without skips, both app builds, migration-history checks, and
`pnpm check`. The enabled built worker became ready and exited with code 0 on
SIGTERM. The first full run caught an incorrect heartbeat column in the new
readiness test; the corrected full rerun passed.

The hosted [v0.0.6 release job](https://github.com/xcvzmoon/pipong/actions/runs/38066800749/job/114255982152)
passed integration gates and versioned image verification. Publication failed
with `permission_denied: write_package`; existing GHCR package Actions access
must be repaired before published-artifact qualification can proceed.

## Delivery bottleneck investigation, 2026-10-11

The 30-minute controlled TLS APNs run accepted all 90,000 requests with
acceptance p95 of 12.285 ms, but dispatch p95 reached about 430 seconds.
The 1,000-delivery burst remained unfinished after 60 seconds. Two API replicas
opened 512 of 1,000 TLS SSE streams; the remaining requests received capacity
responses. These delivery and stream-capacity gates failed.

PostgreSQL profiling reproduced a history-dependent scan in `fetchDeliveryJobs`.
Its global concurrency check counts every active provider job, including jobs
without tenant groups. The pg-boss active-group index excludes ungrouped jobs,
so PostgreSQL scanned completed jobs on every claim. With 150,000 retained jobs,
19,022 count calls consumed 189,161 ms of database execution time; the pg-boss
fetch queries consumed 1,890 ms. A sampled plan visited 4,699 database blocks.

The `delivery_active_claims` migration adds a partial index on queue name for
all active jobs. The same count used four database blocks after migration and
averaged 0.008 ms across 18,096 calls in the follow-up run. A PostgreSQL regression test seeds
50,000 completed jobs, bounds count-query buffer work, and verifies that an
ungrouped active claim still consumes global capacity. It failed before the
migration and passed afterward, along with the other five admission tests.

The load harness accepts `QUALIFICATION_RETAINED_JOBS=150000` to exercise this
history size without waiting for completed jobs to accumulate. These are
synthetic completed queue rows, not a full retained application dataset.
The remaining largest measured database waits are tenant-budget row locks
shared by request admission and terminal settlement. The index preserves those
locks, tenant limits, attempt fences, and retained history.

The 180-second profiling runs used two API replicas, two sequential APNs
consumers, PostgreSQL 18.6, and the local TLS HTTP/2 provider fixture on the shared
macOS arm64 workstation. Both accepted 9,000 requests and sent all 19,000
deliveries, including the final burst. The first run added 150,000 synthetic
completed queue rows after startup; the second preloaded them before consumers
started. The profiler was enabled for both. Other workstation activity and
static checks overlapped the second run, so the latency comparison is diagnostic
evidence rather than an isolated capacity qualification.

| Measurement                             | Before index | After index |
| --------------------------------------- | -----------: | ----------: |
| Active-count average database execution |     9.944 ms |    0.008 ms |
| Quiet tenant dispatch p95               |     38.917 s |     6.917 s |
| Noisy tenant dispatch p95               |     39.190 s |     6.968 s |
| 1,000-delivery burst drain              |     47.207 s |     7.557 s |
| HTTP acceptance p95                     |    14.259 ms |  945.630 ms |

The follow-up still failed acceptance and dispatch targets. Tenant-budget lock
queries were the largest remaining measured SQL costs (about 43 seconds for
admission and 33 seconds for settlement in a sampled mid-run snapshot).
`pg_stat_activity` confirmed transaction and tuple-lock waits on those queries.
The index fixes the history scan; it does not establish the 30-minute dispatch
target or qualify an isolated deployment. Local reports are
`/tmp/pipong-bottleneck-before.json` and `/tmp/pipong-bottleneck-after.json`.

## Publication verification, 2026-10-11

`CI_DATABASE_URL=<dedicated PostgreSQL 18.6 cluster> sh ops/check-ci.sh` passed
250 tests, both deployable builds, migration-history checks, and `pnpm check`.
The load qualification test is opt-in and was the one intentional skip in the
routine suite. Its failed performance gates remain recorded above.

The four `pr-qualified` local images passed `ops/check-images.sh`, including
TLS installation and a clean-volume restore with separate secret backups.
The restore took about 27 seconds with a conservative snapshot loss window of
at most one second. All four images carry the source-repository label.
These images were not published to a registry.

`PIPONG_WAL_PORT=55444 sh ops/check-wal-recovery.sh` passed physical base-backup
manifest verification and named-target recovery: three expected markers restored,
one later committed marker excluded. This small local run took 634 ms with a
305 ms conservative target loss window. Neither measurement establishes
deployment RPO/RTO.

The exercised versions are Node 24.21.0, pnpm 12.6.0, PostgreSQL 18.6, and the
exactly pinned Nitro 3.0.260903-beta. The lockfile SHA-256 is
`3b396c281057740867573a4d75549b992283089dcd9382fd4431212c629d1c79`.

## Required qualification record

For each run, record source commit, lockfile digest, image digests, date, operator,
Node/pnpm/PostgreSQL/framework versions, topology, commands, sanitized results,
and failure observations. Keep raw secrets, device tokens, and payloads out of
public evidence. Link client receipt/display observations to persisted attempt
and provider receipt IDs without publishing identifying values.

| Open gate           | Required observations                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APNs                | Apple account, scoped key, signed push-enabled app; physical device versions; sandbox and production/TestFlight; alert/background, re-registration, receipt correlation                                                 |
| FCM                 | Project/API/IAM identity, instrumented Android app/device, permission and channel state; registration refresh and project mismatch; receipt correlation                                                                 |
| Web Push            | HTTPS service worker; Chromium, Firefox, Safari, iOS Home Screen versions; permissions, VAPID re-subscription, offline TTL, receipt/display correlation                                                                 |
| Full restore        | Qualify active provider sends and queue leases after recovery; reconcile revocations and erasure requests recorded after the snapshot; rehearse WAL recovery and measure RPO/RTO on the intended deployment and dataset |
| Sustained load      | Two API replicas/two workers/PostgreSQL 18 reference topology; 50 accepted requests/s, two endpoints/request for 30 minutes; acceptance p95 <=250 ms, dispatch p95 <=2 s excluding required retry waits                 |
| Burst and fairness  | Backlog drain, 1,000-endpoint submission, noisy tenant alongside quiet tenant; per-tenant admission/dispatch latency and throughput                                                                                     |
| SSE capacity        | 1,000 concurrent TLS clients; environment count, bytes, memory, CPU, DB waits, disconnect/replay and revocation under load                                                                                              |
| Incident rehearsal  | Service/provider/encryption/authentication key compromise, DB outage, backlog and stream recovery using operations runbooks                                                                                             |
| Published artifacts | Successful hosted workflows, registry digests, clean installation without source checkout, pinned compatibility matrix                                                                                                  |

These are proposed acceptance gates from the plan, not supported performance
claims. Delivery load cannot be qualified with disabled provider consumers.
Do not enable them solely to turn readiness green. Use the explicitly enabled consumers and review lifecycle evidence before
running the matrix with deterministic providers,
then qualify real devices without deliberately flooding provider quotas.

See [operations](operations.md) for recovery and containment procedures and the
[verification plan](../brain/plans/01-notification-service/verification.md) for
security, durability, and complete contract scenarios. Record each gate as passed
only after its evidence is reviewed. Leave phase 30 open while any required gate
is missing.
