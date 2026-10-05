# Status and SSE delivery updates

Back to [[plans/01-notification-service/overview]]

## Goal

Expose authoritative status/outcome queries and H3 EventStream over durable replay. Shared readers per environment, bounded buffers, heartbeat/revocation checks, and idempotent disconnect/shutdown cleanup.

## Changes

- packages/service/src/observation.ts
- packages/service/src/event-stream.ts
- tests/observation.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- NotificationSummary, StreamSubscription

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Open actual authenticated streams through TLS proxy on two API replicas; receive worker events, reconnect/replay, revoke and disconnect slow consumers.
- Behavioral scenarios: Status counts; two-replica replay; revoked stream; slow reader; disconnect/shutdown cleanup.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
