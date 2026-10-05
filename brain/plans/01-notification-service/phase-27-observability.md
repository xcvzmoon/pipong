# Health, metrics and audit

Back to [[plans/01-notification-service/overview]]

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

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Trigger DB/provider/configuration failures and observe actual diagnostic endpoints, metrics, audit events and redacted logs.
- Behavioral scenarios: Secret redaction; readiness failure; liveness distinction; privileged audit; bounded metric labels.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
