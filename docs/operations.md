# Release operations

Use the pinned images and secret mounts in [installation](../INSTALLATION.md).
Push consumers default to disabled. Do not route production notification traffic
until the gates in [release evidence](release-evidence.md) pass.

## Backup and restore

Back up the entire database, including auth, app, queue, and migration schemas.
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
