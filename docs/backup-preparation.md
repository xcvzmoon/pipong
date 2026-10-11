# Backup preparation

No off-host destination is configured. Local rehearsal files share the Mac's
failure boundary and do not qualify host-loss recovery.

Prepare two restricted storage locations when remote storage becomes available:

- Database backups and archived WAL, with encrypted storage, retention, and
  credentials that cannot administer the application.
- Secrets needed to restore those backups, with separate access controls.
  Preserve the credential keyring versions, authentication secret, database
  role provisioning credentials, TLS trust material, and operator configuration.

Keep a recovery record with every backup: source revision, lockfile hash, all
four image digests, PostgreSQL version, backup start/finish, cluster identity,
verified manifest, retained WAL range, and the incident ledger location.
Record key IDs, not secret values. Preserve erasure/revocation records separately
so changes after the chosen recovery point can be reconciled before ingress opens.

A logical `pg_dump` provides a snapshot. Point-in-time recovery requires a
physical base backup and an uninterrupted WAL archive from the backup through
the chosen target. Configure and verify archiving before taking the backup;
monitor archive failures and free space. Keep PostgreSQL configuration and TLS
files separately because WAL does not recover external configuration changes.
See [PostgreSQL's continuous-archiving procedure](https://www.postgresql.org/docs/18/continuous-archiving.html).

Once an authorized backup identity, storage destination, and TLS connection are
configured, the PostgreSQL 18 physical backup commands are:

```sh
umask 077
pg_basebackup --dbname="$BACKUP_DATABASE_URL" --pgdata="$BACKUP_DIRECTORY" --wal-method=stream
pg_verifybackup "$BACKUP_DIRECTORY"
```

Use an empty backup directory and credentials from local secret storage. Do not
publish the connection URL or backup contents. Upload the verified backup and
required WAL using the destination's supported client, then verify retrieval
and integrity. `pg_verifybackup` verifies the backup manifest; a real restore
is still required. See [backup verification](https://www.postgresql.org/docs/18/app-pgverifybackup.html).

Retain old credential keys for every retained backup. Apply the restrictions in
[erasure](../ERASURE.md) to historical backup access and restoration.
Do not remove source data or old backups until the replacement recovery chain
has passed verification.

The future host-loss rehearsal must start on an empty deployment with the
original host unavailable. Retrieve the database/WAL and secrets independently,
restore with outbound provider traffic blocked, reconcile the incident ledger,
and run the application checks in [operations](operations.md). Record measured
data loss and elapsed recovery time before reopening traffic.

The current [local recovery runner](../ops/qualify-recovery.sh) verifies mechanics
with disposable clusters. It does not configure scheduled backups, remote
storage, retention automation, or a production recovery guarantee.
