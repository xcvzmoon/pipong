# FCM HTTP v1 delivery

## Progress

- GPT-6.1-Sol final audit passed, 2026-10-10, with no actionable findings. Independent real-library probes verified separate waiter deadlines, immediate refresh handoff after cancellation, socket shutdown, refresh and tenant/version isolation, and zero hidden retries. PostgreSQL 18.6 verification passed all 58 service and 38 database tests without skips; 7 auth and 9 server tests passed, with 56 server integration cases skipped. Check, build, database schema checks, and diff checks passed. One existing APNs lint warning remains. Live Firebase IAM and Android qualification remain open; the next internal integration is phase 23 Web Push.
- Corrected after the concurrency audit, 2026-10-10. Quota receipts persist only fixed categories, never subject fragments or `ErrorInfo.reason`; success and error response shapes are mutually exclusive, preserving error presence before Valibot strips fields. Each send owns its deadline waiter while the auth client owns the shared OAuth exchange signal. A timed-out send detaches without cancelling a refresh still needed by another send; the last waiter or client shutdown cancels the exchange. New callers wait for an aborted exchange to settle before using google-auth-library again. Expiry during OAuth or before send returns through atomic expiry settlement, recording the attempt, delivery, event, and admission release together. Earlier fixes remain in place: one-shot HTTP v1 sends, bounded bodies, refreshed expiry checks, safe Retry-After handling, and fenced generation invalidation. Consumers remain disabled, and phase 24 retry policy stays deferred.
- Regression coverage includes staggered real-library refresh deadlines, all-waiter cancellation followed by a fresh send, shutdown socket cancellation, identifier-bearing quota receipts, contradictory response bodies, and expiry settlement. Verification passed: `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, `pnpm build`, `pnpm database check`, and `git diff --check`. The unconfigured workspace test run passed 14 database, 7 auth, 44 service, and 9 server cases; existing conditional suites skipped 24 database, 14 service, and 56 server cases. Against a disposable PostgreSQL 18.6 cluster, delivery fencing/settlement passed 14 tests, persistence passed 20, and admission passed 5. Live target-project IAM authorization/denial, Android FID and registration-token delivery/refresh, and production OAuth credential isolation remain open release qualifications.

Back to [[plans/01-notification-service/overview]]

## Goal

Use google-auth-library for per-version OAuth and direct HTTP v1 requests to explicit target project, with FID/registration target kind and preserved quota/Retry-After evidence. No deprecated InstanceID operations.

## Changes

- packages/service/src/providers/fcm.ts
- packages/service/src/providers/fcm-auth.ts
- packages/service/tests/fcm.integration.test.ts
- packages/service/tests/attempts.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- FcmBinding, FcmOutcome

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Controlled OAuth/FCM protocol fixtures are covered. Still send to a registered Android installation in the bound Firebase project and verify target-project IAM authorization and denial.
- Behavioral scenarios: Target-kind support; wrong-project IAM; auth refresh; 429/503 hints; invalid registration classification.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
