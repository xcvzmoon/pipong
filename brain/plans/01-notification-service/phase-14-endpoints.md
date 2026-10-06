# Endpoint generations

Back to [[plans/01-notification-service/overview]]

## Goal

Register/update/disable typed APNs, FCM FID/registration, and Web Push endpoints via trusted-backend authority after encryption, credential binding, and egress protection exist. Persist encrypted identifiers/subscriptions, validate binding/VAPID version, and apply destination policy at registration. Every confirmation advances generation, including the same provider identifier.

## Changes

- packages/service/src/endpoints.ts
- packages/service/src/schema/endpoints.ts
- tests/endpoints.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- Endpoint, EndpointGeneration

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Register real-shaped inputs using encrypted storage, bound credential versions and registration-time destination checks; rotate/re-register and conditionally apply a stale invalidation. No untrusted direct client can register another recipient.
- Behavioral scenarios: Encrypted typed registration; same-target refresh; stale invalidation; credential/VAPID binding; registration egress rejection and disable ordering.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
