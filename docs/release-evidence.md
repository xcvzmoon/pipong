# Release qualification evidence

Status on 2026-10-10: internal integration only. Production qualification is open.
Push consumers are disabled and full readiness returns 503. No measured capacity,
availability SLA, provider display guarantee, or production RPO/RTO is published.

## Exercised boundaries

| Gate                 | Evidence                                                                                                                                                                                                                                                                                                                                   | Limit                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database/key restore | `packages/service/tests/release-smoke.integration.test.ts`: actual PostgreSQL 18 dump/restore, repeat migrations, credential decryption, absent-key denial, changed-tenant authentication failure, runtime RLS and DDL denial                                                                                                              | Small synthetic fixture; no full API/worker recovery, historical erasure reconciliation, WAL recovery, or production RPO/RTO                                          |
| Runtime restore      | `apps/server/tests/restore.integration.test.ts`: built API/worker against an empty restored database, separate key backup, sessions, revoked keys, idempotency, pending jobs, ambiguous exhausted attempts, SSE replay, and resumable recipient erasure; `ops/check-images.sh`: clean-volume image restore and recovered API/worker leases | Small synthetic fixtures with disabled push consumers; post-snapshot incident reconciliation, active provider sends, WAL recovery, and production RPO/RTO remain open |
| Provider protocols   | APNs, FCM, Web Push integration suites                                                                                                                                                                                                                                                                                                     | Controlled protocol fixtures; no physical device/browser qualification                                                                                                |
| HTTP/SSE             | Built HTTP observation and TLS stream suites                                                                                                                                                                                                                                                                                               | Functional coverage; no 1,000-client capacity evidence                                                                                                                |
| Installation and CI  | Phase 28/29 local four-image TLS installation and 238-test evidence                                                                                                                                                                                                                                                                        | Remote workflow, registry publication, and installation from published artifacts remain open                                                                          |

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
Do not enable them solely to turn readiness green. Complete consumer integration
and review its lifecycle before running the matrix with deterministic providers,
then qualify real devices without deliberately flooding provider quotas.

See [operations](operations.md) for recovery and containment procedures and the
[verification plan](../brain/plans/01-notification-service/verification.md) for
security, durability, and complete contract scenarios. Record each gate as passed
only after its evidence is reviewed. Leave phase 30 open while any required gate
is missing.
