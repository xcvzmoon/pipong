# Health, metrics, and audit

Run migrations before starting either deployable. Diagnostics use a dedicated
operator token, separate from human sessions and tenant service keys.

## Protected endpoints

Write a random token of 32–256 characters (`A–Z`, `a–z`, digits, `.`, `_`, `~`, or
`-`) into an operator-readable secret file. Set `DIAGNOSTICS_TOKEN_REF` to its
absolute path. The API reads this file at startup; restart it after rotation.
Missing configuration disables all three endpoints. Invalid configuration stops
startup with `TELEMETRY_CONFIG_INVALID`, without printing the file contents.

Send `Authorization: Bearer <operator-token>` over HTTPS. Restrict diagnostic
paths to the monitoring network at ingress as well. Tenant credentials, missing
tokens, and incorrect tokens receive an empty 404. Every response has `no-store`.

| Endpoint            | Result                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health/live`  | 200 while the initialized API process answers HTTP; no database or provider probe                                                                           |
| `GET /health/ready` | 200 when database/schema access, readable credential keyring, four queues, and fresh leases for mail/APNs/FCM/Web Push consumers are present; otherwise 503 |
| `GET /metrics`      | Prometheus text from OpenTelemetry metrics; database failures set `pipong_database_available` to zero                                                       |

Readiness never sends a notification or calls a provider. Workers publish actual
started consumers every 30 seconds, independently of maintenance scans. Leases
expire after 90 seconds using PostgreSQL time and are removed on clean shutdown.
The current worker starts authentication mail only. Delivery consumers remain
disabled pending release qualification, so full readiness intentionally returns
503 even when the API and mail worker are running.

Liveness applies after startup. Invalid startup configuration or inaccessible
startup storage prevents the API from listening at all. Treat readiness failure
as an admission/drain signal; do not use it as a restart probe.

## Logs and traces

HTTP completion logs contain a generated request UUID, a fixed route group,
status, and duration. `x-request-id` matches that UUID. Committed acceptance logs
link request UUID to notification ID. Delivery reservation and
settlement logs correlate notification ID, delivery ID, and attempt generation.
Worker lifecycle and failed maintenance scans use fixed event names.

The allowlist excludes request bodies, URLs, query strings, cookies, bearer
credentials, provider receipts, and raw exceptions. Optional database query
logging emits `database_query` activity without SQL text or parameters.

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (the full HTTP trace endpoint) or
`OTEL_EXPORTER_OTLP_ENDPOINT` (collector base URL) to enable OTLP HTTP traces.
Standard OpenTelemetry exporter headers and TLS configuration apply. Request
spans contain fixed route groups and status only. No automatic HTTP/database
instrumentation runs, and incoming baggage or trace headers are not copied.
Traces flush during API shutdown; the queue holds at most 512 spans.

## Metrics and alerts

Metrics use fixed route groups, HTTP statuses, queue names, consumer names, and
state/kind labels. Tenant, recipient, resource, request, and arbitrary path IDs
never become metric labels. Scrape each API replica. Queue and recovery gauges
are database-wide; aggregate replicas with `max`, rather than summing them.
Database diagnostic queries have a one-second statement timeout and a
250-millisecond lock timeout. A busy or inaccessible database yields unavailable
metrics rather than stale healthy counters.

Load [alert examples](ops/alerts.yml) into Prometheus after configuring an
HTTPS scrape job with the dedicated bearer token. Review thresholds against
actual workloads. The rules cover consumer absence, queue age, exhausted jobs,
ambiguous sends, credential failures, pool waiters, slow SSE, and backup age.
The backup rule requires a backup agent to expose
`pipong_backup_last_success_timestamp_seconds`; the API cannot prove backup
success. The companion missing-metric alert prevents silent loss of that signal.

On queue-age or failed-job alerts, inspect identifier-only job state and follow
[recovery procedures](RECOVERY.md). Ambiguous work can represent an already sent
notification; avoid automatic redrive. Credential failures require validating
provider credentials and permissions. Pool pressure and slow SSE require checking
capacity and clients. Restore a failed backup job and run the restore drill
before considering the backup incident resolved.

## Privileged audit

`app.privileged_audits` records the human actor/session, organization/project/
environment scope, required privileged permission, and database timestamp.
The record shares the authorized operation's transaction. If insertion fails,
the operation rolls back. A callback that returns a domain failure still records
an authorized attempt; a thrown failure rolls back and produces the API failure
log. This ledger records permission-level operations, not payloads or a detailed
before/after history. Existing key, enrollment, erasure, and redrive records keep
their more specific action information.

The API can insert only within its tenant scope and cannot read, update, or delete
this ledger. Worker accounts cannot directly write it. Operators can inspect it
with migration authority. Runtime audit rows have no resource foreign keys so
actor/scope identifiers survive erasure for the 90-day security audit window.
Bounded worker retention removes at most 100 expired rows per scan. Database
superusers can rewrite storage; this is not tamper-proof evidence. Backups and
exported audit copies follow their own documented retention policy.
