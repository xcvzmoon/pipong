# Release operations

Use the pinned images and secret mounts in [installation](../INSTALLATION.md).
Push consumers default to disabled. Do not route production notification traffic
until the gates in [release evidence](release-evidence.md) pass.

## Backup and restore

Back up the entire database, including auth, app, queue, and migration schemas.
See [backup preparation](backup-preparation.md) for the storage, secret, and
recovery-record prerequisites. No off-host destination is currently configured.
Use PostgreSQL 18 tools and an authorized backup identity. A custom-format
`pg_dump` is a consistent snapshot; record its start time and successful finish.
For continuous recovery, configure and rehearse PostgreSQL base backups and WAL
archiving separately. A successful dump alone does not establish an RPO.

Store encrypted database backups and the credential keyring in separate restricted
locations. Keep every key version referenced by retained backups. Also preserve
the authentication secret, operator configuration, TLS trust material, image
digests, and database role provisioning procedure. Never put secrets in evidence
files. Apply the historical-backup exclusions in [erasure](../ERASURE.md).

Rehearse recovery on an isolated host with outbound provider access blocked:

1. Record incident time, last recoverable snapshot/WAL point, and recovery start.
2. Provision PostgreSQL 18 and restricted roles using the installation procedure.
   Restore into an empty database. Keep API and worker stopped.
3. Run `pg_restore --exit-on-error --dbname=<isolated database> <database.dump>`
   with the backup owner identity. Restore role ownership and grants; do not
   discard them with `--no-owner` or `--no-acl`.
4. Mount the matching keyring and authentication secret. Run the pinned migration
   image. A missing key must fail closed; a new random key cannot decrypt a backup.
5. Reconcile erasure requests made after the recovery point before exposing data.
   Check revoked keys and disabled tenants against the incident record. While all
   old and restored workers are stopped, clear `app.worker_heartbeats` so restored
   leases cannot report stopped consumers as ready.
6. Verify enrollment/session access, tenant denial under runtime roles, credential
   decryption, submission idempotency, queue state, status, and event replay.
   Inspect in-flight attempts before resuming workers. A restored queue can
   repeat a send whose provider acceptance happened after the snapshot.
7. Record recovery finish, data-loss interval (RPO), and elapsed recovery time
   (RTO). Route traffic only after the incident owner accepts those results.

The repository smoke test restores a small migrated credential fixture and a
separate key backup. Run with PostgreSQL 18 `pg_dump` and `pg_restore` on PATH:

```sh
TEST_DELIVERY_DATABASE_URL=<disposable trust-authenticated cluster> \
  pnpm service test tests/release-smoke.integration.test.ts
```

It creates and drops databases and fixed runtime roles. Use a dedicated cluster
and run stateful suites sequentially.

The built runtime rehearsal also restores sessions, service keys,
notification idempotency, queued jobs, exhausted attempt history, and event replay.
It replays post-snapshot revocation and erasure records before starting services
and clears snapshot-era worker heartbeats. A real enabled worker crashes during
an active TLS Web Push send; after restoration, pg-boss supervision reclaims the
lease and the worker records an ambiguous attempt followed by provider acceptance.
It restarts the real worker between erasure batches and checks that restored
recipient identities are erased. Build both apps first, then run:

```sh
TEST_AUTH_DATABASE_URL=<disposable trust-authenticated cluster> \
  pnpm server test tests/restore.integration.test.ts --no-file-parallelism --silent=false
```

`ops/check-images.sh` rehearses a separate clean-volume installation restore.
It backs up the database and secret files, removes only its disposable Compose
project and volume, restores into a newly provisioned database, repeats migrations,
and verifies API liveness and worker leases. It prints elapsed recovery time and
an upper bound on the snapshot loss window, including one second for clock rounding.
Run it with the four local release images and `PIPONG_VERSION` set as described
in the installation gate. Both rehearsals deliberately add a post-backup write
and verify that it is absent after recovery.

The image drill uses disabled push consumers. The built-runtime drill exercises
active sends against a controlled TLS provider, rather than a physical device.
Run the separate PostgreSQL 18 WAL rehearsal with:

```sh
PIPONG_WAL_PORT=55442 sh ops/check-wal-recovery.sh
```

It verifies a physical base-backup manifest, restores a named WAL target, and
checks that post-backup markers survive while a later committed marker is
excluded. It creates and removes its own trust-authenticated local cluster.
These local drills do not establish production RPO/RTO or live-device delivery.
Apply post-snapshot incident records before reopening ingress.

Run the built-runtime and separate WAL drills on the local Linux deployment
target with:

```sh
RECOVERY_REPORT_DIR=/tmp/pipong-recovery-evidence sh ops/qualify-recovery.sh
```

The report directory must not already exist. The runner builds the current
checkout and runs PostgreSQL, the built API/worker, test driver, and controlled
TLS provider in one Linux container capped at two CPUs and 2 GiB with no swap.
Its network is isolated; no real provider can receive a test notification.
It records source and image identities, tool versions, test output, peak memory,
and cgroup events, then removes its container and temporary image tags. Failed
runs retain their evidence and return a nonzero exit status.

The runner restores the small application fixture from both a logical backup
and a physical base backup plus archived WAL. The physical path proves that
post-backup revocation and erasure survive replay to a named target while a
later notification is excluded. Both paths check sessions, idempotency, replay,
and active-send lease recovery. Focused credential/service-key tests also check
revocation, encryption rotation, and missing-key failure. The separate WAL marker
drill remains a reference check. These fixtures do not measure a production-sized
dataset or recovery under sustained traffic. Run the clean-volume image drill
separately to verify mounted secrets, role provisioning, database TLS, and
production image startup.

## Compromised credentials

For an organization service key, revoke the key through the authorized service-key
operation and remove its grants. Verify subsequent requests fail and existing SSE
connections close. Inspect permission audits and affected notification IDs.
Revocation does not recall a notification already transmitted to a provider.

For a provider key, suspend affected environments, retire the credential version,
and revoke it at Apple/Firebase or replace the VAPID subscription binding. Install
a new credential version and re-register endpoints where the provider requires
it. Inspect attempts before audited redrive; ambiguous sends may duplicate.

For a credential encryption key, isolate access and assess both live data and
backups. Reencrypt credential versions through the authorized credential rotation
operation. This does not rotate endpoint target ciphertext; keep its referenced
keys until those endpoint generations are replaced or erased. Preserve required
historical decryption keys in restricted recovery
storage until backup retention expires. Rotation cannot undo disclosure.

For an authentication secret compromise, isolate ingress, replace the secret,
invalidate affected sessions, and verify MFA and privileged operations before
reopening access. Follow [authentication](../AUTHENTICATION.md).

## Queue, database, and stream incidents

On database outage, withdraw readiness traffic and preserve durable storage.
Restore connectivity before restarting workers. Check exhausted jobs and ambiguous
attempts using [delivery recovery](../RECOVERY.md); do not manually reset terminal
rows or manufacture success receipts.

On backlog growth, check consumer leases, provider errors, database waits, and
admission limits using [observability](../OBSERVABILITY.md). Respect provider retry
windows. Suspend the affected environment when containment is necessary; already
reserved sends can remain in flight. Redrive only after the cause is fixed.

On SSE disconnects, reconnect with the last durable cursor. An expired cursor
requires a fresh status/replay reconciliation. Confirm proxy buffering is off and
revoked authority closes streams. Do not treat an open stream as delivery proof.

## Local device qualification

The qualification target is this Apple M1 device with eight CPU cores and
8 GiB RAM. Allocate two Docker CPUs and 2 GiB RAM to PostgreSQL and the backend,
leaving room for macOS, Docker, and the host test driver. Run the reference
workload before claiming supported throughput:

```sh
QUALIFICATION_REPORT=/tmp/pipong-local-qualification.json sh ops/qualify-load.sh
```

The script builds the current checkout and places PostgreSQL 18, two API replicas,
and two full workers in one container limited to 2 CPUs and 2 GiB with swap
disabled. It pins that container to virtual CPUs 0 and 1 and records the effective
CPU set. BuildKit build steps use the same CPU, memory, and swap limits through
Docker's `--resource` flags; the installed Docker must support those flags.
A quota alone on a larger Docker VM produced substantial throttling in
local comparisons. The load generator and TLS proxy run on the host outside that budget.
Deterministic provider fixtures run in a separate Linux container limited to
one CPU and 256 MiB on CPU 2, outside the backend cgroup. It shares the backend
network namespace, so provider sends use Linux loopback rather than the
Docker-to-Mac gateway. Docker and the installed workspace dependencies
are required. Database and API ports bind only to host loopback. The script
removes its container and images on exit and retains the sanitized JSON report.
It uses an isolated trust-authenticated database and synthetic credentials.
The worker fixture imports the built lifecycle shared with the production
entrypoint and supplies local APNs, FCM/OAuth, and Web Push transports. All three
push consumers receive traffic; endpoints rotate among providers while keeping
two endpoints per request. Three noisy tenants use different provider pairs
to balance sustained traffic. APNs uses verified HTTP/2 TLS, Web Push uses screened
HTTPS with fixture CA trust, and FCM HTTP v1 plus OAuth exchange use local HTTP.
OAuth signing, token caching/refresh, VAPID signing, and payload encryption run
normally. Auth mail remains idle. Retention, recovery,
erasure scans, and readiness heartbeats run normally. Tests check fresh readiness
leases, startup and periodic audit pruning, and graceful worker shutdown.

The default stress workload is 30 minutes at 50 requests per second, two endpoints per request,
150,000 completed queue rows, a 1,000-endpoint burst, and 1,000 TLS SSE clients
across 20 environments. Streams open before sustained traffic and remain open
throughout it. Twenty independent human sessions and twenty service keys share
the streams. Login setup is paced to respect the real sign-in rate limit.
One sustained request per second targets the stream environments; the rest
exercise quiet/noisy tenants. A subsequent 30-second load phase tests selective
membership/key revocation and cursor replay while unaffected streams continue. Acceptance
p95 must stay within 250 ms and initial dispatch p95 within 2 seconds. The test
also checks exact completion counts, quiet-tenant dispatch, live stream delivery,
revocation, process survival, resource sampling, and generator scheduling lag.

For capacity discovery, set `QUALIFICATION_REQUESTS_PER_SECOND` (3–50) and
`QUALIFICATION_STREAMS` (40–1,000). The same request rate applies during the
subsequent 30-second stream load. Diagnostic durations are 60–1,800 seconds. Reports record both settings, and completion and stream
checks use the configured counts. The 250 ms acceptance and 2-second dispatch
gates remain unchanged. The 50-request/s, 1,000-stream defaults are stress tests;
supported capacity requires a passing 30-minute run at the chosen workload.

The APNs-only full-worker harness passed 30 minutes at 25 requests/s within the
default two-CPU/2-GiB budget, with 1,000 streams held throughout by twenty human
sessions and twenty service keys. Selective revocation and cursor replay also
passed during subsequent traffic. The mixed-provider Linux-loopback harness
also passed 30 minutes at 15 requests/s with 1,000 sustained streams under the
same backend budget. These are verified workloads, not measured capacity ceilings.
Repeat the mixed-provider run with:

```sh
NODE_OPTIONS=--max-old-space-size=256 QUALIFICATION_REQUESTS_PER_SECOND=15 \
  QUALIFICATION_STREAMS=1000 QUALIFICATION_REPORT=/tmp/pipong-local-30m.json \
  sh ops/qualify-load.sh
```

The dispatch latency gate covers sustained quiet/noisy tenants. The separate
1,000-endpoint burst has a drain deadline; it does not claim 2-second dispatch.

For a short diagnostic run, set `QUALIFICATION_SECONDS=60`. Override
`QUALIFICATION_CPUS`, `QUALIFICATION_CPUSET`, `QUALIFICATION_MEMORY`, or
`QUALIFICATION_RETAINED_JOBS`
only when the report names the resulting topology. Choose a CPU set available
to Docker that matches the intended CPU count; changing the quota alone leaves
the default affinity at two CPUs. A short run cannot satisfy
the 30-minute gate. Run on this device with competing services and its
storage characteristics recorded; Docker measurements establish only their
recorded environment. Live provider/device tests and recovery on the
intended deployment remain separate release gates.

The default 2 GiB backend limit fits the previously measured 3.82 GiB Docker
VM. Recheck Docker's CPU and memory allocation before running; the daemon may
use a different allocation after restart. The load generator runs on the host:

```sh
NODE_OPTIONS=--max-old-space-size=256 QUALIFICATION_MEMORY=2g \
  QUALIFICATION_SECONDS=60 QUALIFICATION_REPORT=/tmp/pipong-local-qualification.json \
  sh ops/qualify-load.sh
```

The Node option limits the driver's V8 heap, not its total process memory.
The backend container has a hard 2 GiB limit. Recheck available resources before
running this on another machine; this command is a short local check.
