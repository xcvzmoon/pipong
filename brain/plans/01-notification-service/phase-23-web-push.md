# Standards-based Web Push delivery

Back to [[plans/01-notification-service/overview]]

## Goal

Integrate web-push encrypted request generation with guarded transport and version-bound VAPID keys. Preserve subscription invalidation, provider acceptance, and rotation/re-subscription semantics.

## Changes

- packages/service/src/providers/web-push.ts
- packages/service/src/providers/web-push-payload.ts
- tests/web-push.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- WebPushBinding, WebPushOutcome

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Send to real HTTPS/service-worker subscriptions across the documented browser matrix; controlled transport verifies status classifications.
- Behavioral scenarios: Encryption byte limit; VAPID audience; subscription gone; auth vs endpoint failure; bound-key rotation.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
