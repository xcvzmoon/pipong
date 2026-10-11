# Release qualification evidence

Status on 2026-10-12: internal integration only. Production qualification is open.
Push consumers default to disabled; full readiness requires their fresh leases. No measured capacity,
availability SLA, provider display guarantee, or production RPO/RTO is published.

## Current remaining gates

- Representative-dataset and sustained-traffic recovery on the local target.
- Off-host backups and host-loss rehearsal; no off-host destination is configured.
- Remaining operational incidents, including authentication-secret compromise
  and actual provider-account revocation.
- The original 50-request/s performance envelope. The passing local workloads
  establish lower measured rates, not that original gate.
- Live-provider/device qualification, deferred at the user's request.
- Verify registry publication after the owner-reported package Actions grants,
  then install the intended revision from published artifacts without a source checkout.
- Final review of the evidence and supported claims before release sign-off.

The owner reported correcting Actions access for all four packages on 2026-10-12;
publication has not yet been retried. Hosted baseline CI is green. The [compatibility record](compatibility.md),
[publication checklist](publication.md), and [backup preparation](backup-preparation.md)
describe current prerequisites and limits. Dated failures below remain historical
evidence; later packets supersede their specific unqualified local behaviors.

## Application WAL recovery and focused incidents, 2026-10-11

Small-dataset application physical recovery passed within two CPUs/2 GiB/no
swap on Linux arm64. The base-backup manifest was verified; post-backup service-key
revocation and environment erasure survived archived WAL replay to a named target,
while a later accepted notification was excluded. Built API/worker sessions,
idempotency, status/SSE replay, erasure, and active-send lease recovery passed.
Application recovery took 75,074 ms; peak memory was about 1.25 GiB with no OOM,
memory-limit, or CPU-throttling events. Ten credential/service-key integration
cases passed, covering revocation, encryption rotation, removed-key failure,
credential retirement, and permission/lifecycle boundaries.

See the [complete qualification packet](evidence/quick-qualification-2026-10-11/README.md)
for commands, source/image identities, tool versions, raw results, and limits.
This closes application WAL mechanics with a small dataset; representative
datasets, sustained-traffic and off-host recovery remain open.

## Constrained local deployment recovery, 2026-10-11

The built API/worker recovery and separate physical WAL drills passed on the
current M1's Linux arm64 Docker target within two CPUs/2 GiB/no swap, with
external networking disabled. Application recovery took 74,926 ms, including
active-send queue lease recovery; post-snapshot revocation and erasure were
reconciled before startup. The separate WAL marker fixture recovered in 1,159 ms.
Peak memory was about 794 MiB with no memory-limit, OOM, or CPU-throttling events.
The separate clean-volume production-image drill passed in about 23 seconds,
including separate secret restoration, migrations, API liveness, worker leases,
and graceful shutdown. That Compose drill had no aggregate resource cap and
used disabled push consumers.

See the [deployment recovery packet](evidence/deployment-recovery-2026-10-11/README.md)
for source/image identities, commands, versions, raw results, and scope limits.
The subsequent application WAL packet above closes the small-dataset physical
recovery gap. Sustained-traffic and off-host backup/host-loss rehearsal remain open. These timings do not establish
production RPO/RTO.

## Exercised boundaries

| Gate                 | Evidence                                                                                                                                                                                                                                                                                                                                   | Limit                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database/key restore | `packages/service/tests/release-smoke.integration.test.ts`: actual PostgreSQL 18 dump/restore, repeat migrations, credential decryption, absent-key denial, changed-tenant authentication failure, runtime RLS and DDL denial                                                                                                              | Small credential fixture; application recovery evidence is recorded separately; production RPO/RTO remains open                                                               |
| Runtime restore      | `apps/server/tests/restore.integration.test.ts`: built API/worker against an empty restored database, separate key backup, sessions, revoked keys, idempotency, pending jobs, ambiguous exhausted attempts, SSE replay, and resumable recipient erasure; `ops/check-images.sh`: clean-volume image restore and recovered API/worker leases | Small application fixtures with controlled TLS Web Push; representative dataset, sustained-traffic and host-loss recovery remain open                                         |
| Provider protocols   | APNs, FCM, Web Push integration suites                                                                                                                                                                                                                                                                                                     | Controlled protocol fixtures; no physical device/browser qualification                                                                                                        |
| HTTP/SSE             | Built HTTP observation and TLS stream suites                                                                                                                                                                                                                                                                                               | 1,000 sustained TLS streams passed on the local target; original 50-request/s envelope and live-provider qualification remain open                                            |
| Installation and CI  | Phase 28/29 local four-image TLS installation and 238-test evidence                                                                                                                                                                                                                                                                        | Hosted CI passed for b02aa056; v0.0.6 registry publication failed; owner reports Actions grants corrected; registry publication and current-artifact installation remain open |

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

## Current qualification target, 2026-10-11

The user replaced the 2-vCPU/8-GB VPS target with this local Apple M1 device.
Hardware inspection reports eight CPU cores, 8 GiB RAM, and arm64. The backend
qualification budget is two Docker CPUs pinned to `0,1`, 2 GiB RAM, and no swap;
`ops/qualify-load.sh` now uses that memory limit by default. The host driver,
TLS proxy, and provider fixture remain outside the backend budget.

Docker was stopped when the target changed. Recheck its allocation before the
next run. Previous local evidence shows this budget completed 8,500 deliveries
and 1,000-stream delivery/revocation checks, with about 1.18 GiB backend peak
memory. Dispatch p95 was 2.52 seconds, above the unchanged 2-second gate.
The 30-minute run, full workers, independent principals, live devices, recovery,
and published artifacts remain open. Historical VPS results below retain their
original resource limits; they do not qualify this revised target.

## Local capacity discovery, 2026-10-11

Docker restarted with eight virtual CPUs and 4,106,604,544 bytes of VM memory.
The Mac was connected to AC power; `caffeinate -i` prevented idle sleep during
runs. The backend cgroup confirmed `cpu.max=200000 100000`, CPU set `0-1`,
`memory.max=2147483648`, and `memory.swap.max=0`. The driver used a 256 MiB V8
heap ceiling outside that budget. Local activity was not isolated; these runs
are diagnostics rather than production capacity evidence.

The 60-second 50-request/s baseline accepted all 3,000 sustained and 1,500
stream-load requests and completed all 8,500 deliveries. All 1,000 TLS SSE
streams received delivery events and passed revocation. Acceptance p95 was
1,366.19 ms; quiet/noisy dispatch p95 was 6,436.55/6,838.70 ms. Stream-load
acceptance p95 was 48.37 ms, and the burst drained in 7,043 ms. Backend peak
memory was 1,258,315,776 bytes, with no quota throttling or sampling failures.
The acceptance and dispatch latency gates failed. Raw evidence is
`/tmp/pipong-capacity-baseline.json` and `.log`.

The harness now accepts `QUALIFICATION_REQUESTS_PER_SECOND` (2–50) and
`QUALIFICATION_STREAMS` (20–1,000), records the workload, and checks exact
completion and stream counts for that workload. Latency, revocation, scheduling,
and resource checks remain unchanged. The default 50-request/s, 1,000-stream
workload is a stress test until qualified.

The 60-second comparison at 25 requests/s retained 1,000 streams and passed all
existing checks. It accepted all 1,500 sustained and 750 stream-load requests
and completed all 4,750 deliveries. Sustained acceptance p95 was 31.44 ms;
quiet/noisy dispatch p95 was 1,003.70/989.05 ms. Stream-load acceptance p95 was
29.77 ms. All 1,000 streams received events, remained live, and closed on
revocation; reconnect returned 404. Backend memory peaked at 1,236,008,960 bytes
(about 1.15 GiB), with no sampling failures. Cgroup quota throttling totaled
129 microseconds across two periods. Both app builds passed for each run.

The 1,000-endpoint burst drained in 7,563 ms, with burst dispatch p95 7,487.3 ms.
The existing 2-second dispatch gate applies to the sustained quiet/noisy tenants,
not this burst. This run does not establish a 2-second burst latency claim.
Raw comparison evidence is `/tmp/pipong-capacity-25.json` and `.log`.

Use 25 requests/s and 1,000 streams as a candidate for the 30-minute local run,
not a supported capacity claim. Full worker ancillary tasks, independent
principals, live providers, recovery, and publication remain separate gates.
Disposable containers and tagged images were removed after both runs.

## Full local qualification, 2026-10-11

The 30-minute run at 25 requests/s passed all existing qualification checks.
It offered 45,000 sustained requests over 1,799,964 ms; all returned 202.
Acceptance p95 was 18.77 ms, with maximum arrival-schedule lag 47 ms.
Quiet/noisy sustained dispatch p95 was 960.05/959.00 ms. The backend and
PostgreSQL shared two CPUs pinned to `0,1`, a hard 2 GiB memory limit, and no
swap. The run retained 150,000 completed queue rows and used two API replicas
and two APNs consumer fixtures, with the driver/proxy/provider outside the cap.

All 91,750 expected deliveries completed and matched provider request counts:
90,000 sustained deliveries, a 1,000-endpoint burst, and 750 stream-load
deliveries. The burst drained in 7,050 ms, with dispatch p95 6,711.15 ms;
the sustained 2-second gate does not apply to that burst.

After sustained traffic and the burst, the separate 30-second stream-load
phase held 1,000 TLS SSE streams across 20 environments at 25 requests/s.
All streams received delivery events and remained live, with zero stream errors.
All 750 requests returned 202; acceptance p95 was 30.50 ms. Revocation closed
streams within the test window and reconnect returned 404. This does not prove
1,000 streams held for the entire 30-minute sustained phase.

Backend cgroup peak memory was 1,839,071,232 bytes (about 1.71 GiB).
All four Node processes survived, resource sampling had zero failures, and CPU
quota throttling totaled 276 microseconds across two periods. The cgroup
confirmed `cpu.max=200000 100000`, CPU set `0-1`,
`memory.max=2147483648`, and `memory.swap.max=0`. Both app builds passed.
The test completed in 1,864.05 seconds and exited 0; disposable containers and
tagged images were removed. Evidence is `/tmp/pipong-local-30m.json` and `.log`.

This closes the 30-minute gate for this local harness at 25 requests/s.
It does not qualify 50 requests/s, sustained 30-minute SSE capacity, full worker
ancillary tasks, independent principals, live providers, or another deployment.
Those checks, deployment recovery, and published artifacts remain open.

## Full worker runtime qualification, 2026-10-11

The harness now imports the built `runWorker` lifecycle used by the production
entrypoint. Only the APNs HTTP/2 connection is supplied by the local verified TLS
fixture. Both workers start auth mail, APNs, FCM, and Web Push consumers, refresh
readiness leases, and run retention, recovery, and erasure scans. FCM, Web Push,
and auth mail have no channel traffic in this workload; no SMTP service is used.
The emitted production entrypoint and runtime export import the same built chunk.

New checks require two fresh all-consumer leases throughout resource sampling,
removal of expired audit probes at startup and on a subsequent retention cycle,
and clean exit, lease removal, and `worker_stopped` after SIGTERM.

The 60-second full-worker comparison passed at 25 requests/s and 1,000 streams
within two CPUs/2 GiB/no swap. Acceptance p95 was 22.70 ms and quiet/noisy
sustained dispatch p95 was 951.40/960.00 ms. All 4,750 deliveries completed.
All streams passed delivery/revocation; stream-load acceptance p95 was 33.47 ms.
Worker readiness and resource sampling had zero failures; the periodic audit
probe was pruned and graceful shutdown checks passed. Backend peak memory was
1,041,952,768 bytes (about 0.97 GiB), with no CPU quota throttling.
Evidence is `/tmp/pipong-full-worker-short.json` and `.log`.

The 30-minute full-worker run passed all checks at 25 requests/s within the same
resource budget. All 45,000 sustained requests returned 202, acceptance p95 was
18.99 ms, and quiet/noisy sustained dispatch p95 was 966.05/958.00 ms.
All 91,750 deliveries completed and matched provider request counts. The burst
drained in 7,050 ms, with burst dispatch p95 6,612.30 ms; the sustained 2-second
gate does not cover burst latency.

The subsequent 30-second stream phase held all 1,000 TLS streams, delivered
events to every stream, and passed revocation and denied reconnect checks.
All 750 concurrent-load requests returned 202; acceptance p95 was 34.09 ms,
with zero stream errors. Streams were not held throughout the sustained phase.

Both workers kept fresh all-consumer readiness leases with zero readiness or
resource sampling failures. Startup retention removed 200 expired audit probes,
then a later retention cycle removed a new probe. Graceful shutdown checks passed:
both workers exited 0, emitted `worker_stopped`, and removed their leases.
Backend memory peaked at 1,718,255,616 bytes (about 1.60 GiB), with no CPU quota
throttling. The cgroup confirmed two CPUs pinned to `0,1`, a hard 2 GiB memory
limit, and no swap. The test completed in 1,865.03 seconds and exited 0.
Both app builds passed; disposable containers and tagged images were removed.
Evidence is `/tmp/pipong-full-worker-30m.json` and `.log`.

This closes the full-worker lifecycle gate for this local APNs fixture workload.
Auth mail, FCM, and Web Push consumers were running without channel traffic;
independent principals, sustained 30-minute SSE, mixed-provider load, live
providers, deployment recovery, and publication remain open.

## Mixed-provider qualification, 2026-10-11

The load harness now rotates endpoint providers across APNs, FCM, and Web Push,
balancing the noisy traffic across three tenants with different provider pairs.
It keeps two deliveries per request, the 1,000-endpoint burst, and 1,000 sustained
SSE streams across forty session/key principals. Each environment has one
immutable credential version per provider it uses. Completion counts and
sustained dispatch p95 are checked separately for every provider, alongside
the existing tenant, stream, maintenance, and shutdown gates.

The worker shares its built lifecycle with production. Its fixture transport
uses APNs HTTP/2 TLS, Web Push screened HTTPS with a trusted fixture CA, and local
FCM HTTP v1/OAuth endpoints. FCM uses the production OAuth client to sign real
RSA assertions, cache tokens, and refresh fifteen-minute tokens during long runs.
Web Push performs VAPID signing and payload encryption. Fixtures check bearer
and VAPID headers, message shape, and nonempty encrypted payloads.

The 60-second diagnostic at 25 requests/s failed. All 1,500 sustained requests
returned 202, with acceptance p95 44.93 ms. APNs/FCM dispatch p95 was 962/964 ms,
but Web Push dispatch p95 reached 8,036 ms across sustained and subsequent
traffic. Only 5,414 of 5,502 expected deliveries had completed at final sampling.
The mixed burst drained in 24,853 ms. Peak memory was 1,217,912,832 bytes (about
1.13 GiB), with no readiness, continuity, or sampling failures. All 1,000 streams
remained live throughout sustained traffic; exactly 50 revoked connections
closed in 422 ms, 950 continued, and replay passed. Fixture protocol errors were
zero. Evidence is `/tmp/pipong-mixed-provider-25rps-short.json` and `.log`.

An initial diagnostic was stopped after finding a double-slash URL in the FCM
fixture's OAuth route; URL construction now uses a normalized origin. The 15-request/s comparison completed all 3,702 deliveries, but Web Push
transport retries still failed latency gates. The original per-provider report
joined every attempt and counted eight retried Web Push deliveries twice; its
1,214 count was not the actual delivery count of 1,206. Provider request counts
sum to 3,702. Evidence is `/tmp/pipong-mixed-provider-15rps-short.json` and `.log`.

The harness now counts only first attempts for initial-dispatch measurements
and reports all attempt outcomes separately. A diagnostic with sanitized Node
transport error codes was run at 15 requests/s to investigate the connection
failures. Two isolated 500-request TLS probes, one against HTTP/2 with HTTP/1
support and one against HTTPS, had zero failures. This does not establish
mixed-provider capacity.
The shared-listener diagnostic timed out before saving a report. A subsequent
run with separate host listeners still recorded six Web Push connection
aborts at the 10-second transport deadline; all 3,702 deliveries completed after
retries, but latency gates failed. Evidence is
`/tmp/pipong-mixed-provider-separated.json` and `.log`.

Provider fixtures now run in a separate Linux container sharing the backend
network namespace, with one CPU and 256 MiB outside the backend cgroup. TLS
verification and production provider adapters remain active. The short Linux
loopback comparison passed at 15 requests/s: all 900 sustained requests and
450 subsequent requests returned 202, and all 3,702 deliveries completed without
retries or transport failures. Acceptance p95 was 44.72 ms; APNs/FCM/Web Push
initial dispatch p95 was 968/977/960 ms. The burst drained in 8,822 ms. All 1,000
streams remained live and recently active for 65,169 ms; exactly 50 revoked
connections closed in 457 ms, 950 unaffected streams continued, and replay
passed. Peak backend memory was 1,213,566,976 bytes (about 1.13 GiB), with one
47-microsecond CPU throttle. Maintenance, readiness, resource sampling,
continuity, and graceful shutdown checks passed. Evidence is
`/tmp/pipong-mixed-provider-linux-short.json` and `.log`.

The 30-minute Linux-loopback qualification passed at 15 requests/s with two
API replicas, two full workers, and PostgreSQL sharing two CPU cores and 2 GiB
RAM with no swap. All 27,000 sustained requests returned 202; acceptance p95
was 34.56 ms. All 55,902 deliveries completed: 18,109 APNs, 19,796 FCM, and
17,997 Web Push. Initial dispatch p95 was 963/962/957 ms respectively, and the
highest non-burst tenant p95 was 979.7 ms. There were no retries, transport
failures, or provider protocol errors. FCM performed 102 OAuth exchanges,
including 64 refresh exchanges during sustained traffic after ten minutes.

All 1,000 streams stayed live and recently active for 1,805,159 ms across forty
session/key principals. There were no unexpected closures, frame errors, or
sequence gaps. Selective revocation closed exactly 50 connections in 1,024 ms;
950 unaffected streams continued, denied reconnects returned 404/401, and cursor
replay passed. Subsequent traffic returned 202 for all 450 requests with an
acceptance p95 of 62.85 ms. The 1,000-endpoint burst drained in 8,313 ms; its
299.21 ms acceptance and drain time are outside the sustained latency gates.

Peak backend memory was 1,599,463,424 bytes (about 1.49 GiB). CPU throttling
occurred in 13 periods, totaling 99,636 microseconds. Readiness, maintenance,
resource sampling, stream continuity, and graceful worker shutdown checks
passed. Disposable containers and qualification images were removed. Evidence
is `/tmp/pipong-mixed-provider-30m.json` and `.log`.

This establishes a local fixture workload, not a measured capacity ceiling.
The failed host-path comparisons do not establish backend throughput limits.
Provider fixtures, the load driver, and the TLS proxy remain outside the backend
budget. Auth mail remains idle. Live provider TLS/OAuth, quotas, failures, device
receipt, deployment recovery, and published-artifact gates remain open.

## Sustained independent-principal SSE qualification, 2026-10-11

The revised harness opens streams before sustained traffic and keeps them open
throughout the load and burst. Twenty real human sign-ins and twenty HTTP-issued
service keys supply forty distinct principals across twenty environments.
Sign-ins run in batches of three separated by an 11-second idle gap, respecting
Better Auth's last-request-based limiter. Fixture users reuse the isolated
account's password hash; API authentication, grants, and live authorization run
normally. No production rate limits or authorization rules were changed.

One request per second targets the stream environments, with remaining traffic
split between quiet/noisy tenants. Every request has two endpoints. The harness
parses stream frames, checks scope binding and contiguous event sequences, and
samples liveness plus delivery within a rolling 60-second window. During the
subsequent 30-second load it revokes one membership and a different environment's
key, checks only affected connections close, denies their reconnects, and resumes
an unaffected stream from its last cursor after a new notification is submitted.
That replay probe adds one request and two deliveries to completion accounting.

The 60-second comparison at 25 requests/s passed with all 1,000 streams live,
delivered, and recently active after 64,980 ms. There were zero sequence gaps,
frame errors, unexpected closures, continuity failures, readiness failures,
or sampling failures. Exactly 50 affected streams closed within 1,038 ms;
950 unaffected streams continued receiving events. Membership/key reconnect
statuses were 404/401, and cursor replay passed.

All 5,502 deliveries completed. Acceptance p95 was 28.07 ms; quiet/noisy dispatch
p95 was 939.20/955.00 ms. The subsequent stream-load acceptance p95 was 31.97 ms.
Backend peak memory was 1,155,805,184 bytes (about 1.08 GiB), with no CPU quota
throttling, under two CPUs/2 GiB/no swap. Worker maintenance and shutdown checks
passed. Evidence is `/tmp/pipong-independent-sse-short.json` and `.log`.

The full run additionally checks dispatch p95 for every stream environment and
inserts its periodic retention probe immediately before sustained traffic.
The 30-minute run passed at 25 requests/s with two API replicas and two full
workers sharing two CPU cores and 2 GiB RAM, with swap disabled. All 45,000
sustained requests returned 202, and all 92,502 deliveries completed. Acceptance
p95 was 26.13 ms; quiet/noisy dispatch p95 was 970/964 ms. The highest dispatch
p95 across stream environments was 984 ms. The burst drained in 7,057 ms;
the sustained 2-second dispatch gate does not cover the burst.

All 1,000 streams stayed live and received ordered events for 1,804,989 ms.
There were zero sequence gaps, frame errors, unexpected closures, continuity
failures, worker readiness failures, or sampling failures. Selective revocation
closed exactly 50 connections within 548 ms, while 950 unaffected streams
continued receiving events. Revoked membership/key reconnects returned 404/401,
and cursor replay passed. Subsequent stream-load acceptance p95 was 51.85 ms.

Backend peak memory was 1,775,276,032 bytes (about 1.65 GiB). CPU quota throttling
occurred once for 1,097 microseconds. Startup and periodic audit pruning, process
survival, and graceful worker shutdown passed. Disposable containers were removed.
Evidence is `/tmp/pipong-independent-sse-30m.json` and `.log`.

These forty reader principals do not represent 1,000 distinct users; notification
submissions still use the administrator session. Local APNs TLS transport, idle other channels,
fixture credentials, and driver/proxy resources outside the backend cap remain
qualification boundaries. Mixed-provider/live-device load, deployment recovery,
and publication remain open.

## Admission and stream qualification, 2026-10-11

The intended minimum deployment is a VPS with 2 vCPU and 8 GB RAM. This is a
qualification target; the 50-request/s envelope remains a release gate.

Bulk acceptance now inserts ordered queued events and provider queue jobs in
batches within the original acceptance transaction. Regression coverage checks
1,000 mixed-provider deliveries, contiguous event sequences, idempotent replay,
queue defaults and tenant groups, retention protection, and complete rollback
when a queue insertion is suppressed. Existing tenant budgets avoid a redundant
conflict insert, admission counters use one update, and terminal releases use
one locked SQL statement. Claim completion stays in the settlement transaction
and precedes shared quota/event writes. All 41 database tests passed after these
changes.

The stream limit is now 1,024 per API process, with the existing 64-reader
per-environment bound, bounded queues, and write deadlines retained. Live
authority checks share results only for the same complete principal during one
poll. Built HTTP tests exercise the exact process cap, slot reuse, independent
human sessions and service keys, and selective revocation while other streams
continue receiving events.

`ops/qualify-load.sh` runs the backend and PostgreSQL together under a shared
2-CPU/8-GB limit with swap disabled. Driver, TLS proxy, and deterministic provider
run outside that limit. The report records backend and driver runtime separately,
resource peaks, CPU throttling, database waits, offered request timing, process
survival, stream bytes, delivery counts, and revocation. See
[minimum VPS qualification](operations.md#local-device-qualification) for the
repeatable command and gates. Local Docker uses Linux arm64; its VM has about
3.82 GiB of physical memory, less than the configured 8-GB container ceiling.
This environment cannot establish the memory capacity of the intended VPS.
The workload uses one human session across its environments and an APNs-only
consumer harness. It does not qualify many independent principals or the full
worker service with its ancillary tasks.

## Backend CPU constraint result, 2026-10-11

The first isolated 60-second run, before the attempted atomic stream-counter
upsert, used commit
`a2bdc31855062b0eb9bcd6ef6ff559360ddc21a8` plus the uncommitted admission,
stream, and qualification changes above. The lockfile digest remains
`3b396c281057740867573a4d75549b992283089dcd9382fd4431212c629d1c79`.
The command was:

```sh
QUALIFICATION_SECONDS=60 QUALIFICATION_RETAINED_JOBS=150000 \
  QUALIFICATION_REPORT=/tmp/pipong-enterprise-vps-short.json sh ops/qualify-load.sh
```

No builds or regression suites overlapped the measured backend workload. The
host generator offered 3,000 requests over 59.98 seconds; maximum scheduling lag
was 46 ms (57 ms during stream load). The cgroup reported `cpu.max=200000 100000`,
`memory.max=8589934592`, and `memory.swap.max=0`.

| Measurement                      | Result                                                                                                 | Gate                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Sustained acceptance             | 2,991 accepted; 9 responses were 503; p95 8,777.7 ms                                                   | Failed; all 3,000 and p95 <=250 ms required                            |
| Initial dispatch                 | Quiet p95 36,173.3 ms; noisy p95 36,198.8 ms                                                           | Failed; p95 <=2,000 ms required                                        |
| 1,000-endpoint burst             | Accepted in 822.5 ms; drained in 32,257 ms                                                             | Drained; latency envelope remains open                                 |
| SSE                              | 1,000 live streams across 20 environments; all received events; no stream errors                       | Capacity and delivery checks passed for this short run                 |
| Request load with SSE            | 1,500 accepted; p95 6,431.6 ms                                                                         | Failed; p95 <=250 ms required                                          |
| Revocation                       | All streams closed within the test window; reconnect returned 404                                      | Passed                                                                 |
| Completion at measurement cutoff | 7,962 completed of 8,500 offered deliveries; 8,016 provider requests                                   | Failed; backlog remained and 18 offered deliveries were never accepted |
| Resources                        | No sampling failures; all four backend Node processes survived; cgroup memory peak 1,686,519,808 bytes | Process/resource checks passed                                         |
| CPU                              | 287.4 CPU seconds; 1,097 of 1,590 periods throttled; 188.8 seconds aggregated throttling               | CPU pressure observed                                                  |

The JSON report and log are `/tmp/pipong-enterprise-vps-short.json` and
`/tmp/pipong-enterprise-vps-short.log`. Provider requests can advance between the
report snapshot and the following assertion while backlog is still running;
the assertion observed one additional request. Remaining work at the cutoff is
a throughput failure, not evidence of a lost committed delivery. The script
removed its container and images after the failed gates.

A separate intrusive diagnostic captured worker and API CPU profiles and
normalized PostgreSQL statement statistics. The tenant-budget locking select
accumulated 68.9 seconds over 2,838 calls; admission settlement accumulated
18.2 seconds over 1,934 calls. Queue claim selection averaged about 0.15 ms,
so the earlier retained-history scan is no longer the dominant query. Inspector
cleanup interrupted one diagnostic worker after its sample; subsequent API and
SQL timings are diagnostic only. These observations point to contention and
query-processing cost under the CPU ceiling; they do not justify removing quota
serialization or live authorization.

A second clean 60-second run tested an atomic stream-counter upsert. It accepted
1,973 of 3,000 requests, returned 1,027 responses with status 503, and had
acceptance p95 8,780.5 ms. Quiet/noisy dispatch p95 was 30,912.9/31,011.6 ms.
With stream load, 1,171 of 1,500 requests were accepted with p95 11,987.2 ms;
all 1,000 streams received events, but only 300 stayed live and revocation missed
the test window. Completion and provider counts were both 6,117. The cgroup
peaked at 1,585,930,240 bytes and throttled in 1,180 of 1,774 periods; sampling
had no failures. Raw evidence is `/tmp/pipong-enterprise-vps-final-short.json`
and `.log`. These results do not establish a deadlock or another specific cause.
The upsert optimization was reverted to separate stream initialization and
sequence update before the next comparison. Batch event insertion remains.

The repeat after reverting the upsert accepted all 3,000 sustained requests
and all 1,500 requests during stream load. Acceptance p95 was 692.4 ms and
351.7 ms respectively; both still exceed 250 ms. Quiet/noisy dispatch p95 was
6,030/6,051 ms, above the 2,000-ms gate. The burst was accepted in 273.4 ms and
drained in 8,058 ms. All 8,500 deliveries completed with exactly 8,500 provider
requests. All 1,000 streams remained live, received events, and passed revocation;
there were no stream errors or resource sampling failures. Cgroup memory peaked
at 1,584,332,800 bytes; 948 of 1,213 periods were throttled, with 212.2 CPU seconds
and 100.4 seconds aggregated throttling. Raw evidence is
`/tmp/pipong-enterprise-vps-reverted-short.json` and `.log`. This short repeat
supports retaining separate stream initialization and update. It does not close
the latency or deployment qualification gates, and the variation across runs
prevents a supported capacity claim from a single favorable result.

Final routine validation passed `ops/check-ci.sh`: 254 tests, both deployable
builds, migration-history checks, and `pnpm check`. The opt-in load test was the
one intentional skip in that run and was exercised separately above. The
50-request/s envelope on 2 vCPU remains unqualified. The 30-minute deployment
run, full worker services, live provider/device matrix, and publication gates
remain open.

## Budget contention and CPU affinity, 2026-10-11

These 60-second comparisons used the same source commit and lockfile digest as
above, with the uncommitted qualification changes. Each offered 3,000 sustained
requests plus 1,500 requests during stream load, retained 150,000 queue jobs,
and used two API replicas, two APNs consumer processes, and PostgreSQL 18.
The Docker VM exposed eight CPUs but about 3.82 GiB of physical memory.
No regression suites, builds, or CPU inspector sessions overlapped measurement.
Read-only PostgreSQL statement snapshots were taken every 15 seconds.

| Comparison                                                       | Acceptance p95 | Quiet/noisy dispatch p95 | Stream-load acceptance p95 | Accepted/completed                                            |
| ---------------------------------------------------------------- | -------------- | ------------------------ | -------------------------- | ------------------------------------------------------------- |
| Quota-only baseline                                              | 2,556.5 ms     | 21,697.9/21,733.1 ms     | 1,120.8 ms                 | 4,500 requests; 8,497 deliveries at report cutoff             |
| Combined post-lock admission reads                               | 2,823.0 ms     | 20,586.8/20,640.0 ms     | 364.8 ms                   | 4,500 requests; 8,500 deliveries                              |
| Combined reads plus update-first stream counter                  | 7,606.7 ms     | 29,676.5/29,666.7 ms     | 706.6 ms                   | 6 sustained requests returned 503; 8,268 deliveries at cutoff |
| Combined reads, original stream initialization, CPU affinity 0-1 | 1,854.6 ms     | 5,574.7/5,577.0 ms       | 199.5 ms                   | 4,500 requests; 8,500 deliveries                              |
| Separate reads, original stream initialization, CPU affinity 0-1 | 785.6 ms       | 4,832.6/4,867.2 ms       | 278.0 ms                   | 4,500 requests; 8,500 deliveries                              |

All five runs passed the 1,000-stream delivery and revocation checks. The final
pinned baseline drained the burst in 8,325 ms, had no sampling failures, and
kept all four backend processes alive. Its memory peak was about 1.699 GB.
CPU quota remained `200000 100000`, memory ceiling 8 GiB, and swap ceiling zero;
`cpuset.cpus.effective` was `0-1`. Throttling fell from 997 of 1,362 periods and
142.1 aggregate seconds in the quota-only baseline to 7 periods and 3,569
microseconds in the pinned baseline. Total CPU use was 247.5 versus 191.9 seconds.

The latest quota-only baseline statement snapshot recorded tenant-budget
locking at 25.56 seconds over 4,437 calls, with a 511.9-ms maximum. The final
pinned baseline snapshot recorded 10.15 seconds over 4,484 calls, with a
188.5-ms maximum. These totals include statement execution and waiting; they
are not direct measurements of lock-hold time. CPU affinity reduced measured
throttling and budget waits in these runs. It does not establish actual VPS
performance or isolate every source of local variation.

Combining the post-lock reservation, clock, and key-budget reads removed round
trips but showed no clear overall latency benefit. Updating the stream counter
before initialization removed common-path inserts but regressed acceptance.
Both application experiments were reverted. The harness retains CPU affinity
and reports its effective CPU set. New regressions cover fresh reservation/key
reads after waiting for a budget lock and concurrent initial stream batches,
including rollback without cursor gaps. The multi-stage revocation test has a
20-second outer test timeout; each five-second revocation deadline is unchanged.

Raw reports/logs are `/tmp/pipong-budget-baseline.*`,
`/tmp/pipong-budget-combined-short.*`, `/tmp/pipong-budget-updatefirst-short.*`,
`/tmp/pipong-budget-pinned-short.*`, and `/tmp/pipong-budget-pinned-baseline.*`.
Normalized statement snapshots are the corresponding `*-statements.txt` files;
the first baseline uses `/tmp/pipong-budget-pg-statements.txt`. All disposable
containers were removed. The final baseline still fails acceptance, dispatch,
and stream-load acceptance latency. No 30-minute pass or supported 50-request/s
capacity follows from these short experiments. Full workers, many independent
principals, intended-deployment recovery, live providers/devices, and published
artifacts remain open.

Final validation after the application reverts passed `ops/check-ci.sh`: 256
routine tests, both deployable builds, migration-history checks, and `pnpm check`.
The sole opt-in load skip was exercised separately in the five comparisons above.

## Local CPU and RAM caps, 2026-10-11

The local host has eight logical CPUs and 8 GiB RAM. Docker exposes eight CPUs
and about 3.82 GiB RAM; a pre-run snapshot reported about 3.32 GiB available
inside the VM. Use two CPUs pinned to `0,1`, a hard 2 GiB backend limit, and no
swap for this machine. BuildKit build steps now receive the same resource caps.
A disposable build probe verified `cpu.max=200000 100000`, CPU set `0-1`,
`memory.max=2147483648`, and `memory.swap.max=0`.
The host driver uses a 256 MiB V8 heap ceiling; its RSS, proxy, and provider
remain outside the backend limit.

The corrected diagnostic run accepted all 4,500 requests, completed all 8,500
deliveries, and passed the 1,000-stream delivery/revocation checks. Its memory
peak was 1,935,970,304 bytes, with zero memory-limit, OOM, or OOM-kill events.
Sustained acceptance p95 was 760.1 ms, stream-load acceptance 4,467.0 ms,
and quiet/noisy dispatch 16,796.3/16,835.0 ms. PostgreSQL duration logging and
Node inspector sampling add overhead, so these are diagnostic observations.
An earlier diagnostic lacked transaction logs because its temporary entrypoint
was malformed; it was corrected before this run.

The copied PostgreSQL log covered 4,370 acceptance transactions, 7,956 worker
reservation transactions, and 7,955 settlements, rather than the entire run.
Acceptance transaction wall time averaged 40.07 ms (p95 135.06 ms), versus
8.91 ms summed server statement durations. The interval from completion of
the budget-lock statement to commit averaged 15.96 ms (p95 49 ms). This interval
is a lower bound on lock ownership, not an exact lock-hold measurement.
Worker reservation wall time averaged 10.89 ms (p95 27.01 ms), versus 2.07 ms
summed statement durations; settlement averaged 10.45 ms (p95 26.04 ms), versus
3.94 ms summed statement durations. The gaps include client scheduling,
networking, and logging effects; they do not establish an ORM CPU bottleneck.

Ten-second CPU samples recorded idle shares of 79.75% for one API process and
64.31% for one consumer. The consumer's 1,172 checkout samples all had an idle
connection available, with p95 0.038 ms. API checkout instrumentation targeted
a different loaded constructor and yielded no samples; that metric is unavailable.
Private raw SQL logs were deleted after aggregation. Sanitized evidence is
`/tmp/pipong-local-profile-transactions.json`, `.log`, and
`/tmp/pipong-local-profile-summary.json`. The diagnostic container was removed.

The subsequent uninstrumented 60-second comparison used the same caps and
150,000 retained jobs. All 4,500 requests returned 202, all 8,500 deliveries
completed, and all 1,000 streams stayed live with delivery and revocation checks
passing. Sustained acceptance p95 was 91.82 ms and stream-load acceptance
75.48 ms, both within the 250 ms target. Quiet/noisy dispatch p95 was
3,921.90/4,013.05 ms, exceeding the 2-second target; the qualification test
therefore failed. The burst drained in 7,553 ms. Backend memory peaked at
1,329,233,920 bytes (about 1.24 GiB), with no resource sampling failures or
memory-limit, OOM, or OOM-kill events. All four processes survived, and the
disposable container was removed.
CPU usage was 167.27 seconds, with four throttled periods totaling 1,113
microseconds. Evidence is `/tmp/pipong-local-clean.json` and `.log`.
This establishes that the short workload fits the local resource limit, while
dispatch latency and the sustained production qualification remain open.

## Dispatch claim comparison, 2026-10-11

Retained one focused change: provider budget and active-claim count are read in
one statement after acquiring the existing provider advisory lock. This removes
one database round trip per claim. Counts still include ungrouped active jobs,
and provider/tenant limits and sequential send behavior are unchanged.

Under the same two-CPU, 2 GiB, no-swap limits, the 60-second run accepted all
4,500 requests, completed all 8,500 deliveries, and passed all 1,000-stream
delivery/revocation checks. Acceptance p95 was 75.13 ms and stream-load acceptance
138.47 ms. Quiet/noisy dispatch p95 fell to 2,517.1/2,518.0 ms from the preceding
clean baseline's 3,921.9/4,013.05 ms, a reduction of about 36–37%. Dispatch still
exceeded the 2-second target, so qualification failed. The burst drained in
7,586 ms. Memory peaked at 1,270,591,488 bytes (about 1.18 GiB); memory-limit
and OOM counters were zero, with no sampling failures. CPU usage was 167.00
seconds. Report/log are `/tmp/pipong-dispatch-claim.json` and `.log`.

Parallel-send experiments were removed. Four sends per consumer regressed
acceptance p95 to 599.84 ms and completed 8,441 deliveries at cutoff. Two sends
with the original APNs client completed 8,453 deliveries; a live aggregate
recorded 47 `DELIVERY_SENDER_FAILED` ambiguous attempts. A protocol regression
confirmed that the APNs client rejected overlapping sends on one connection.
Correcting its busy tracking completed all 8,500 deliveries, but acceptance p95
629.60 ms and stream-load acceptance 5,116.99 ms regressed, while dispatch
remained around 4.2 seconds. Both scheduling and transport experiments were
reverted. Reports are `/tmp/pipong-dispatch-four.*`,
`/tmp/pipong-dispatch-two.*`, and `/tmp/pipong-dispatch-multiplex.*`.
All disposable containers were removed. These comparisons support the smaller
claim-query change, not increased concurrency or a production capacity claim.

Final verification of the retained implementation passed `ops/check-ci.sh`:
256 routine tests, both builds, migration-history checks, and `pnpm check`.
The opt-in load test was exercised separately in these comparisons. No commits,
pushes, or image publication were performed.

The [archived local reports](evidence/local-qualification-2026-10-11/README.md)
preserve all available reports from the local 30-minute qualification sequence
and mixed-provider diagnostics, including failed comparisons.

## Required qualification record

For each run, record source commit, lockfile digest, image digests, date, operator,
Node/pnpm/PostgreSQL/framework versions, topology, commands, sanitized results,
and failure observations. Keep raw secrets, device tokens, and payloads out of
public evidence. Link client receipt/display observations to persisted attempt
and provider receipt IDs without publishing identifying values.

| Open gate           | Required observations                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APNs                | Apple account, scoped key, signed push-enabled app; physical device versions; sandbox and production/TestFlight; alert/background, re-registration, receipt correlation                                 |
| FCM                 | Project/API/IAM identity, instrumented Android app/device, permission and channel state; registration refresh and project mismatch; receipt correlation                                                 |
| Web Push            | HTTPS service worker; Chromium, Firefox, Safari, iOS Home Screen versions; permissions, VAPID re-subscription, offline TTL, receipt/display correlation                                                 |
| Full restore        | Representative-dataset physical/WAL recovery under sustained traffic, off-host backup retrieval and host-loss rehearsal, and measured deployment RPO/RTO                                                |
| Sustained load      | Two API replicas/two workers/PostgreSQL 18 reference topology; 50 accepted requests/s, two endpoints/request for 30 minutes; acceptance p95 <=250 ms, dispatch p95 <=2 s excluding required retry waits |
| Burst and fairness  | Backlog drain, 1,000-endpoint submission, noisy tenant alongside quiet tenant; per-tenant admission/dispatch latency and throughput                                                                     |
| SSE capacity        | 1,000 concurrent TLS clients; environment count, bytes, memory, CPU, DB waits, disconnect/replay and revocation under load                                                                              |
| Incident rehearsal  | Service/provider/encryption/authentication key compromise, DB outage, backlog and stream recovery using operations runbooks                                                                             |
| Published artifacts | Successful hosted workflows, registry digests, clean installation without source checkout, pinned compatibility matrix                                                                                  |

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
