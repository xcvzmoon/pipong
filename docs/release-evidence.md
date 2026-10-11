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
| HTTP/SSE             | Built HTTP observation and TLS stream suites                                                                                                                                                                                                                                                                                               | Functional 1,024-stream process-cap and revocation coverage; deployment capacity remains open                                                                         |
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
[minimum VPS qualification](operations.md#minimum-vps-qualification) for the
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
