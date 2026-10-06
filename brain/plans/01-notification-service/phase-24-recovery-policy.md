# Retries, expiry, cancellation and redrive

Back to [[plans/01-notification-service/overview]]

## Goal

Implement provider-aware successor scheduling, absolute expiry and attempt caps, pending cancellation, and privileged redrive lineage. Reconcile exhausted infrastructure recovery into visible outcomes, not lost jobs.

## Changes

- packages/service/src/delivery-policy.ts
- packages/service/src/recovery.ts
- tests/recovery.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- RetryDecision, RecoveryOutcome

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Inject transient/ambiguous/permanent responses into running workers; advance controlled clock and observe terminal outcomes and audited redrive.
- Behavioral scenarios: Provider delay floors; Retry-After/expiry; cancel race; exhausted crash recovery; redrive duplicates/history.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
