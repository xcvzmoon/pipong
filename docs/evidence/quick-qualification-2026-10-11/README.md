# Application WAL recovery and focused incident evidence

Operator: Codex, 2026-10-11. Source revision:
`b02aa05640cf088fd990640375ff2161d5c7afad` plus the uncommitted physical
recovery fixture and recovery-test changes. The existing application builds
were unchanged. [Source checksums](source-checksums.txt) identify the tested
fixture, test, and frozen runner. Lockfile SHA-256:
`3b396c281057740867573a4d75549b992283089dcd9382fd4431212c629d1c79`.

Command:

```sh
cp ops/qualify-recovery.sh /tmp/pipong-quick-qualification-runner.sh
RECOVERY_REPORT_DIR=/tmp/pipong-quick-qualification-final-20261011 sh /tmp/pipong-quick-qualification-runner.sh
```

The Linux arm64 container was capped at two CPUs pinned to 0 and 1, 2 GiB,
and no swap. External networking was disabled. All fixture PostgreSQL clusters,
built API/worker processes, driver, and controlled TLS Web Push receiver shared
the cap. Tool versions were Node 24.21.0, pnpm 12.6.0, PostgreSQL 18.6, and
Nitro 3.0.260903-beta. The local recovery image was
`sha256:3c7e2a1960ddd4d80d83836b4ad8025609378d6118a01c2f0eb410b1be67be08`.

- Logical application restore passed in 76,201 ms, with a conservative
  recovery-point loss interval of 129 ms. Post-backup incidents were replayed
  from the separately preserved ledger before startup.
- Physical application restore passed in 75,074 ms, with a conservative
  recovery-point loss interval of 18 ms. The physical backup manifest was
  verified. Key revocation and environment erasure committed after the base
  backup survived archived WAL replay to the named target. One notification
  accepted after that target was absent as expected.
- Both restored paths verified sessions, credential decryption, idempotency,
  notification status, SSE replay, stale heartbeat removal, resumable erasure,
  and queue/admission accounting. A worker killed during a TLS send recovered
  its lease, retained an ambiguous attempt, and completed an accepted retry.
- Ten focused real-PostgreSQL/built-HTTP cases passed in 14.71 seconds. Coverage
  included cross-replica service-key revocation/expiry, permanent credential
  retirement, encryption rotation, removed-key failure, MFA/scope/RLS denial,
  and lifecycle races. These reused the existing credential/service-key suites.
- The separate reference WAL marker fixture passed in 251 ms with a conservative
  target loss interval of 39 ms and the expected later marker excluded.
- Peak cgroup memory was 1,338,093,568 bytes (about 1.25 GiB). Memory-limit,
  OOM/OOM-kill, and CPU-throttling counters were zero. The runner exited zero;
  its disposable container and temporary image tags were removed.

Sanitized output: [environment](environment.txt), [logical restore](runtime.txt),
[application WAL restore](application-wal.txt), [incident checks](incidents.txt),
[reference WAL](wal.txt), and [resources](resources.txt).

An earlier attempt passed both restore modes but its wrapper encountered a
shell syntax error after the running script was edited. That incomplete attempt
does not qualify the full sequence. The complete frozen-copy rerun above passed.
The final runner also rejects incomplete sequences even if shell cleanup sees
a zero exit status.

This closes small-dataset application physical recovery and focused local
credential incidents. Production-sized datasets, recovery under sustained
traffic, authentication-secret compromise, actual provider-account revocation,
and off-host/host-loss recovery remain unqualified. No off-host destination is
configured. These times are rehearsal measurements, not production RPO/RTO.
