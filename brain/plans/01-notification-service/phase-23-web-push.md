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

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Send to real HTTPS/service-worker subscriptions across the documented browser matrix; controlled transport verifies status classifications.
- Behavioral scenarios: Encryption byte limit; VAPID audience; subscription gone; auth vs endpoint failure; bound-key rotation.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.

## Implementation evidence (2026-10-10)

- Implemented locally with per-request aes128gcm generation, immutable VAPID/subscription binding checks, guarded HTTPS, and atomic fenced settlement. No dependency or schema change was required; registration/public-key REST operations already exist.
- Real HTTPS fixtures verify encrypted body bounds, audience including port, old/new/old key rotation, terminal/auth errors, Retry-After, expiry, and connect-time screening. PostgreSQL 18.6 fixtures verify 404/410 invalidation, refreshed generation preservation, 403 preservation, admission release, receipts, and lost-claim rollback.
- All 77 service tests passed without skips against disposable PostgreSQL. Workspace check and build passed. Workspace tests passed with database/server integration skipped where their environment was absent; service integration was run separately with its database configured.
- Operator contract: [Web Push delivery](../../../WEB-PUSH.md). Live Chrome/Firefox/Safari service-worker and installed iOS web-app qualification remains open. Provider consumers remain disabled. Next internal packet is phase 24 recovery policy.
