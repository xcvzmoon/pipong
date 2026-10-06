# Application recipient identities

Back to [[plans/01-notification-service/overview]]

## Goal

Implement project/environment-scoped recipient upsert/read and redacted endpoint inspection. Validate external identity without mapping it to Better Auth users or assuming globally unique emails.

## Changes

- packages/service/src/recipients.ts
- packages/service/src/schema/recipients.ts
- tests/recipients.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- Recipient

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Upsert the same external ID in two environments and inspect only the authorized record through the service and its HTTP packets.
- Behavioral scenarios: Scoped identity collision; repeat upsert; wrong tenant; redaction; pagination boundary.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
