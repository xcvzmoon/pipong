# Release qualification evidence

Status on 2026-10-10: internal integration only. Production qualification is open.
Push consumers are disabled and full readiness returns 503. No measured capacity,
availability SLA, provider display guarantee, or production RPO/RTO is published.

## Exercised boundaries

| Gate                 | Evidence                                                                                                                                                                                                                      | Limit                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Database/key restore | `packages/service/tests/release-smoke.integration.test.ts`: actual PostgreSQL 18 dump/restore, repeat migrations, credential decryption, absent-key denial, changed-tenant authentication failure, runtime RLS and DDL denial | Small synthetic fixture; no full API/worker recovery, historical erasure reconciliation, WAL recovery, or production RPO/RTO |
| Provider protocols   | APNs, FCM, Web Push integration suites                                                                                                                                                                                        | Controlled protocol fixtures; no physical device/browser qualification                                                       |
| HTTP/SSE             | Built HTTP observation and TLS stream suites                                                                                                                                                                                  | Functional coverage; no 1,000-client capacity evidence                                                                       |
| Installation and CI  | Phase 28/29 local four-image TLS installation and 238-test evidence                                                                                                                                                           | Remote workflow, registry publication, and installation from published artifacts remain open                                 |

Run `ops/check-ci.sh` against a dedicated disposable PostgreSQL 18 cluster.
The restore test additionally requires PostgreSQL 18 client binaries on PATH.
The current CI image gate does not replace the following manual gates.

Local validation on 2026-10-10 passed `ops/check-ci.sh` against PostgreSQL 18.6:
239 tests without skips, both deployable builds, migration-history checks, lint,
formatting, and typechecks. This run did not rebuild or republish container images.

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
| Full restore        | Separate database/key recovery on clean installation; sessions, revocations, erasure reconciliation, pending/in-flight jobs, idempotency, replay; measured recovery point and elapsed recovery time     |
| Sustained load      | Two API replicas/two workers/PostgreSQL 18 reference topology; 50 accepted requests/s, two endpoints/request for 30 minutes; acceptance p95 <=250 ms, dispatch p95 <=2 s excluding required retry waits |
| Burst and fairness  | Backlog drain, 1,000-endpoint submission, noisy tenant alongside quiet tenant; per-tenant admission/dispatch latency and throughput                                                                     |
| SSE capacity        | 1,000 concurrent TLS clients; environment count, bytes, memory, CPU, DB waits, disconnect/replay and revocation under load                                                                              |
| Incident rehearsal  | Service/provider/encryption/authentication key compromise, DB outage, backlog and stream recovery using operations runbooks                                                                             |
| Published artifacts | Successful hosted workflows, registry digests, clean installation without source checkout, pinned compatibility matrix                                                                                  |

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
