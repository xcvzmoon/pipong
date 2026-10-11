# Local deployment recovery rehearsal

Operator: Codex, 2026-10-11. Target: Apple M1 host, Linux arm64 Docker backend.
Source: `b02aa05640cf088fd990640375ff2161d5c7afad` plus the new
`ops/qualify-recovery.sh` runner. Application code was unchanged.
Lockfile SHA-256:
`3b396c281057740867573a4d75549b992283089dcd9382fd4431212c629d1c79`.

Command:

```sh
RECOVERY_REPORT_DIR=/tmp/pipong-deployment-recovery-20261011 sh ops/qualify-recovery.sh
```

The isolated container used two CPUs pinned to virtual CPUs 0 and 1, 2 GiB,
and no swap. PostgreSQL, the test driver, built API and worker, and controlled
TLS Web Push provider shared that cap. External networking was disabled.
Node 24.21.0, pnpm 12.6.0, PostgreSQL 18.6, and Nitro 3.0.260903-beta were used.
Docker's VM had eight CPUs and 4,106,604,544 bytes available.

- Application recovery passed in 74,926 ms. The conservative logical-snapshot
  loss interval was 98 ms; one deliberately accepted post-snapshot notification
  was absent after restore.
- Post-snapshot key revocation and environment erasure were replayed from the
  separate incident ledger before startup. Sessions, credential decryption,
  idempotency, status, SSE replay, erasure completion, and admission accounting passed.
- The worker was killed during an active TLS send. Recovery reclaimed the queue
  lease, retained the ambiguous attempt, and completed a subsequent accepted send.
- The separate physical WAL fixture passed in 1,159 ms, with a conservative
  target loss interval of 38 ms. Backup-manifest verification passed; all three
  expected markers survived and the later committed marker was excluded.
- Peak cgroup memory was 833,003,520 bytes (about 794 MiB). Memory-limit, OOM,
  OOM-kill, and CPU-throttling counters were zero. Runner exit status was zero.
- The disposable recovery container and its temporary image tags were removed.

Raw output, with terminal control sequences removed:
[environment](environment.txt), [runtime](runtime.txt), [WAL](wal.txt),
and [resources](resources.txt). These files contain fixture identities and no
provider credentials or real device tokens.

The recovery image was
`sha256:bb79c1876109ffa4af7446b4a07b865b173ef8c414522d06167d43ad05aeadac`.
Image identities describe local builds, not published registry artifacts.

The separate clean-volume image drill passed:

```sh
PIPONG_VERSION=recovery-20261011 sh ops/check-images.sh
```

It restored the database and separately backed-up secrets into a fresh Compose
volume, repeated migrations, checked retained/absent organizations, API liveness,
and worker leases. Recovery took about 23 seconds; the conservative snapshot
loss interval was at most one second. Graceful shutdown removed worker leases;
the disposable project, network, and volume were removed. Push consumers were
disabled. This Compose drill had no aggregate two-CPU/2-GiB cap. See
[image output](images.txt).

Local image identities:

- Server: `sha256:de1a78d4271b49cdf05395907668c9031366fb54dac5c04b10f67febec61cc54`.
- Worker: `sha256:19e4fd9b007f991d8b74bea195c8d8f6676fe5beec3d59a069284694b04ee66b`.
- Migrator: `sha256:6dcc7d8ae1ac9d9f518f989595bde89eac3f926f7ef193e0fd11aec58be52e99`.
- Database: `sha256:b9bf2e049c7c9535d832f507f46b956ff15334c97c7c7828a8f4270e390da8a7`.

The runtime drill used a small logical application backup. The WAL drill used
a separate marker database. This does not qualify physical WAL recovery of the
application dataset, recovery during sustained traffic, disk/host loss, or an
off-host backup destination. Those deployment gates remain open. The observed
times are rehearsal measurements, not production RPO/RTO guarantees.
