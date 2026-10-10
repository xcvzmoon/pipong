# Health, metrics and audit

Back to [[plans/01-notification-service/overview]]

## Status

- Implemented locally, 2026-10-10. Protected liveness/readiness/Prometheus routes with OpenAPI, operator secret-file authentication, redacted structured correlation, and bounded OpenTelemetry request spans/metrics are available.
- Readiness checks schema/queue access, readable credential keyring, and fresh consumer leases. Worker heartbeats refresh independently of maintenance and drain before lease deletion. Delivery consumers remain disabled, so full readiness intentionally stays 503 until release qualification enables them.
- Privileged permission-level audits commit with authorized operations, survive resource erasure for 90 days, and use insert-only API grants with FORCE RLS. Bounded worker retention cannot delete fresh audits. Dedicated key/enrollment/redrive/erasure records retain their existing details.
- Verification covered 237 workspace tests without skips against PostgreSQL 18.6 UTF-8 across final suite runs: 38 database, 7 auth, 107 service, and 85 server tests. Built HTTP tests cover protected diagnostics, OpenAPI responses, DB/keyring failures, expired leases, blocked-maintenance refresh, clean worker shutdown, audit rollback/retention, and secret-free metric labels/logs. Local OTLP HTTP export passed. Install, check, deployable builds, and migration checks passed.
- Senior architecture/security review found no remaining blocking issues after fixing persisted credential codes and independent heartbeat scheduling. Runtime tests also fixed PostgreSQL array binding and the column grant required for lease deletion.
- Operator setup and retained-data limits are in `OBSERVABILITY.md`; eleven alert examples in `ops/alerts.yml` parsed successfully. Backup alerts require an external backup agent. Provider/device qualification and deployment packaging remain release work; next is phase 28 self-hosted installation.

## Goal

Add structured redacted telemetry, protected health/metrics, append-only privileged-action audit, and queue-age/recovery/backup alert definitions. No public secret-bearing diagnostics.

## Changes

- packages/service/src/telemetry.ts
- packages/service/src/audit.ts
- tests/telemetry.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- AuditEvent, RuntimeHealth

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Trigger DB/provider/configuration failures and observe actual diagnostic endpoints, metrics, audit events and redacted logs.
- Behavioral scenarios: Secret redaction; readiness failure; liveness distinction; privileged audit; bounded metric labels.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
