# Retries, expiry, cancellation and redrive

Back to [[plans/01-notification-service/overview]]

## Status

- Implemented locally, 2026-10-10. Next is phase 25 status and SSE.
- Shared retry policy enforces provider floors, exponential delay with additive jitter, Retry-After, absolute expiry, and eight committed send reservations including crash recovery.
- Environment-scoped cancel and privileged recent-MFA redrive HTTP operations include OpenAPI contracts. Redrive creates a new admitted chain with immutable actor/reason/source lineage; each source is redriven once.
- Worker startup and 60-second reconciliation resolve retained exhausted jobs into terminal states, ambiguous attempt history, ordered events, and admission release. A copied standalone worker was verified without workspace dependencies.
- PostgreSQL 18.6 verification passed 204 tests across database (38), auth (7), service (92), and server (67), without skips. Check, workspace build, and migration schema checks passed. Review found one unfinished crash-history issue, fixed with an actual eighth-send recovery regression; final review found no further actionable issues.
- Provider consumers remain disabled; live provider qualification and production release gates remain open. Operator/API behavior is documented in `RECOVERY.md`.

## Goal

Implement provider-aware successor scheduling, absolute expiry and attempt caps, pending cancellation, and privileged redrive lineage. Reconcile exhausted infrastructure recovery into visible outcomes, not lost jobs.

## Changes

- packages/service/src/delivery-policy.ts
- packages/service/src/recovery.ts
- packages/service/tests/recovery.integration.test.ts; delivery-policy.test.ts
- Database-owned recovery persistence and audit migration, worker reconciliation, and cancel/redrive HTTP adapter packets.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- RetryDecision, RecoveryResult

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Inject transient/ambiguous/permanent responses into running workers; advance controlled clock and observe terminal outcomes and audited redrive.
- Behavioral scenarios: Provider delay floors; Retry-After/expiry; cancel race; exhausted crash recovery; redrive duplicates/history.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
