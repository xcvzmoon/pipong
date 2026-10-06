# Web Push destination policy

Back to [[plans/01-notification-service/overview]]

## Goal

Implement guarded destination validation/connection pinning, TLS verification, response limits, total deadlines, and operator-only private-origin exceptions. Reuse web-push request generation, not custom crypto.

## Changes

- packages/service/src/egress.ts
- packages/service/src/web-push-transport.ts
- tests/egress.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- AllowedDestination, EgressPolicy

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Run a controlled DNS/HTTPS fixture and attempt public/private/rebinding/redirect requests through the actual transport.
- Behavioral scenarios: DNS rebinding; IPv4-mapped IPv6; redirect; bounded body/deadline; allowed private exception.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
