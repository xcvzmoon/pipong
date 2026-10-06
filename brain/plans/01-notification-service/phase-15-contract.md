# Validated send contract

Back to [[plans/01-notification-service/overview]]

## Goal

Define the canonical submission schema, provider-specific payload encoders and byte accounting, target expansion bounds, expiry semantics, and RFC 9457 errors. Count server-added metadata.

## Changes

- packages/service/src/notification-contract.ts
- packages/service/src/provider-payloads.ts
- tests/notification-contract.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- NotificationRequest, ProviderPayload, ApiProblem

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Invoke encoders with multibyte/boundary data and produce requests consumed by local provider protocol fixtures.
- Behavioral scenarios: UTF-8 byte bounds; reserved fields; TTL unit conversion; unsupported overrides; expansion/body bound.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
