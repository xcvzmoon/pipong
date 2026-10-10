# Status and SSE delivery updates

Back to [[plans/01-notification-service/overview]]

## Status

- Implemented locally, 2026-10-10. Next is phase 26 suspension and data erasure.
- Notification list/summary, notification delivery pages, and redacted delivery attempts have authorized HTTP operations and generated OpenAPI validation. Summary and delivery/attempt queries use single statement snapshots; cursors bind tenant, collection, and notification parent.
- H3 EventStream uses shared durable readers, bounded queues/connections, write deadlines, heartbeat/live authority checks, and idempotent disconnect/shutdown cleanup. TLS tests use two built API replicas and actual worker event writes, including cross-replica replay, late subscriber history, cursor failures, membership/key revocation, slow sinks, and reusable connection slots.
- PostgreSQL 18.6 verification covered all 215 workspace cases without skips across final suite runs: database 38, auth 7, service 92, server 78. The server suite includes six SSE scenarios. Check, workspace build, and migration checks passed. The final audit is recorded below.
- Runtime fixtures explicitly enable Node graceful shutdown; CI/TEST-disabled termination is also verified. Stream signal hooks follow the pinned srvx runtime's shutdown mode, and cleanup closes streams before the database.
- API attempt SELECT uses a tenant-scoped FORCE RLS policy; direct foreign reads and API writes are denied. User/operator behavior is documented in `OBSERVATION.md` and `EVENTS.md`.
- Provider consumers remain disabled; live provider qualification and production release gates remain open.

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

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Open actual authenticated streams through TLS proxy on two API replicas; receive worker events, reconnect/replay, revoke and disconnect slow consumers.
- Behavioral scenarios: Status counts; two-replica replay; revoked stream; slow reader; disconnect/shutdown cleanup.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.

## Final audit, 2026-10-10

Reviewed architecture, authorization, RLS, pagination, status snapshots, stream
fairness, resource bounds, shutdown, tests, and public contracts.

- Fixed a high-severity stream stall: event reads now set transaction-local SQL
  and lock timeouts before authorization. A held database lock cannot indefinitely
  block unrelated environments or shutdown.
- Fixed replay starvation: subscribers share pages by cursor, so a historical
  backlog does not delay a subscriber already reading live events.
- Follow-up review caught representative revocation affecting other credentials
  sharing its cursor. Authorization failure now closes only that subscriber;
  remaining authorized subscribers retry on the next poll.
- Status queries, tenant isolation, attempt redaction, cursor binding, and the
  attempt SELECT policy had no actionable findings. Final source review found no
  remaining actionable issues.
- Validation after fixes: all 78 server and 92 service tests passed against PostgreSQL without
  skips, including held-lock isolation and live replay fairness. Workspace checks
  and build passed.
- Live provider qualification and production release gates remain open. This
  audit covers phase 25; phase 26 has not been implemented.
