# Suspension, erasure, and retention

DELETE first commits a lifecycle tombstone and a durable erasure job. New
submissions, send-start reservations, and scoped writes are denied after that
commit. Cleanup runs in the worker on startup and every minute, with at most ten
jobs per scan and 100 records per cleanup stage. Each batch commits its own
progress, so another worker can resume after a restart.

## HTTP requests

| Target       | DELETE path                                                   | Authority                   | Response            |
| ------------ | ------------------------------------------------------------- | --------------------------- | ------------------- |
| Organization | `/api/v1/organizations/{organizationId}`                      | Owner with recent MFA       | 202 erasure receipt |
| Project      | `/api/v1/organizations/{organizationId}/projects/{projectId}` | Owner/admin with recent MFA | 202 erasure receipt |
| Environment  | Project path + `/environments/{environmentId}`                | Owner/admin with recent MFA | 202 erasure receipt |
| Recipient    | Environment path + `/recipients/{recipientId}`                | `recipient:write`           | 204                 |

A receipt contains `erasureId`, `requestedAt`, and `inFlightUntil`. It confirms
acceptance, not completed cleanup. Repeating a scope DELETE encounters its
existing lifecycle tombstone and returns the authorization failure for that
scope. Recipient deletion queues the same cleanup without returning a receipt.

Project/environment suspension preserves data and blocks sends. DELETE also
suspends the target, so a separate suspension request is unnecessary. Organization
erasure disables the organization. Native Better Auth deletion remains blocked;
its invitation operations lock the live organization through their transaction.
Creating an invitation requires an explicit `organizationId`; invitation operations
use their `invitationId` to resolve the organization.

## Reserved sends

A committed send-start reservation is already in flight, even when network I/O
has not begun. Its worker owns a snapshot and may settle within two minutes of
the erasure request. A transient result after cancellation gets no successor.
At the deadline, a late receipt is recorded as ambiguous and canceled. Cleanup
also abandons unfinished attempts, cancels their queue jobs, releases admission,
and records cancellation events. A late worker cannot settle an abandoned fence.
Every snapshot also has a `sendUntil` deadline, at most two minutes after its
reservation. APNs, FCM, and Web Push refuse an expired snapshot before provider
I/O and cap transport deadlines to the remaining time. A worker resumed after a
long pause cannot start a send from its expired snapshot. External pushes already
submitted cannot be recalled.

The deadline bounds settlement eligibility. A stopped worker or a cleanup backlog
can delay the persisted abandonment and data cleanup until a later scan. The
receipt does not promise a wall-clock completion time.

## Erased and retained data

Cleanup removes notification bodies, provider receipts, encrypted endpoint targets,
installation identifiers, recipient external identities, and scoped credential
ciphertexts/public keys. It retires credentials and disables endpoints. Project
and environment names become null. Organization names/slugs become ID tombstones;
its metadata, logo, invitations, memberships, and active session organization
selections are removed. Scoped service keys and grants are revoked, and stored
key hashes and metadata are cleared. Organization cleanup also clears unbound
keys and queued invitation email data.

Recipient erasure leaves shared provider credentials and environment grants in
place. An affected notification body is removed in full, including when that
notification targeted other recipients. Pending deliveries in that notification
are canceled too. Other notifications and their endpoints remain available. After
the external identity is cleared, a fresh upsert can enroll that
identity with a new recipient UUID. The old recipient and endpoint IDs stay deleted.

Technical UUIDs, ownership links, timestamps, terminal delivery counts, and
lifecycle tombstones remain. Idempotency fingerprints and acceptance responses
remain for the original seven-day replay window. Human accounts and their sessions
can belong to other organizations and remain usable there.

| Retained data                                            | Worker policy                                   |
| -------------------------------------------------------- | ----------------------------------------------- |
| Notification bodies and settled attempt details          | 30 days; unresolved sends are preserved         |
| Replay events and idempotency responses                  | Seven days; event watermarks advance atomically |
| Erasure, enrollment, key, redrive, and privileged audits | 90 days; active erasure jobs remain             |

Retention deletes at most 100 rows per table per environment batch. Redrive audit
reasons remain for the audit window. Database backups, WAL, exported records, and
provider-side copies are outside live-database erasure. Operators own their expiry
and restore procedures. Before exposing a restored database, replay erasure
requests accepted after the restored snapshot.

## Operator checks

Apply migrations before starting the API and worker. Use an administrator
connection to inspect progress; cleanup discovery and mutation functions are
worker-only, and the worker has no general access to authentication tables.

```sql
SELECT id, kind, target_id, stage, requested_at, in_flight_until,
       updated_at, completed_at
FROM app.erasure_jobs
ORDER BY requested_at;
```

A completed job has `stage = 'done'` and `completed_at` set. Batch failures roll
back progress, log `ERASURE_BATCH_FAILED` or `RETENTION_BATCH_FAILED`, and retry on
the next scan. Discovery failures log the corresponding `*_SCAN_FAILED` code.
Investigate persistent failures or an increasing backlog. Jobs waiting on reserved
sends keep their stage until settlement or the deadline.

Verification uses disposable PostgreSQL, separate worker processes, built HTTP
routes, live authorization, queue fences, secret removal, tenant preservation,
restartable batches, and retention watermarks. Provider consumers remain disabled;
live provider and production release qualification remain open.
