# FCM HTTP v1 delivery

Back to [[plans/01-notification-service/overview]]

## Goal

Use google-auth-library for per-version OAuth and direct HTTP v1 requests to explicit target project, with FID/registration target kind and preserved quota/Retry-After evidence. No deprecated InstanceID operations.

## Changes

- packages/service/src/providers/fcm.ts
- packages/service/src/providers/fcm-auth.ts
- tests/fcm.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- FcmBinding, FcmOutcome

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Exercise controlled HTTP fixtures then send to a registered Android installation in the bound Firebase project.
- Behavioral scenarios: Target-kind support; wrong-project IAM; auth refresh; 429/503 hints; invalid registration classification.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
