# Native APNs delivery

Back to [[plans/01-notification-service/overview]]

## Goal

Audit and integrate @parse/node-apn with explicit topic/environment/key binding, bounded HTTP/2 pools, JWT refresh, alert/background payloads, raw error fidelity, and controlled retry behavior.

## Changes

- packages/service/src/providers/apns.ts
- packages/service/src/providers/apns-client.ts
- tests/apns.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- ApnsBinding, ApnsOutcome

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Exercise local HTTP/2 protocol failure fixtures and send through sandbox plus production apps/devices before marking the provider gate complete.
- Behavioral scenarios: Alert/background headers; key/topic isolation; 410 timestamp race; 5xx retry floor; shutdown/GOAWAY.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
