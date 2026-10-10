# Native APNs delivery

Back to [[plans/01-notification-service/overview]]

## Goal

Audit @parse/node-apn and integrate a native APNs adapter with explicit topic/environment/key binding, bounded HTTP/2 pools, JWT refresh, alert/background payloads, raw error fidelity, and controlled retry behavior.

## Changes

- packages/service/src/providers/apns.ts
- packages/service/src/providers/apns-client.ts
- packages/service/tests/apns.integration.test.ts

Receipt persistence requires the delivery-attempt schema/migration and worker column grant. Fenced APNs settlement reuses the database attempt and endpoint repositories; its PostgreSQL scenarios live in packages/service/tests/attempts.integration.test.ts. No new HTTP operation is introduced; existing credential, endpoint, and submission operations supply the immutable binding.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- ApnsBinding, ApnsOutcome, ApnsRuntime, ApnsResponse

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Exercise local HTTP/2 protocol failure fixtures and send through sandbox plus production apps/devices before marking the provider gate complete.
- Behavioral scenarios: Alert/background headers; key/topic isolation; 410 timestamp race; 5xx retry floor; shutdown/GOAWAY.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.

## Implementation evidence

- Implemented on feat/native-apns-delivery, 2026-10-10; awaiting PR review and merge. Provider consumers remain disabled until all adapters are integrated.
- Audited released @parse/node-apn 8.1.0. Its client retries automatically, drops Retry-After, and replaces some raw reasons. A zero retry limit cannot repair that response loss; the adapter uses Node HTTP/2 and crypto instead. See [APNs operator documentation](../../../APNS.md).
- Tenant/application/credential/environment-bound cache, at most 32 clients, one connection and in-flight request per client; idle eviction and shutdown destroy connections. ES256 JWT refresh at 50 minutes, verified Apple TLS, ten-second total request deadline, and 8 KiB response limit.
- Generation-bound encrypted snapshots, alert/background headers, raw receipt persistence, timestamp-conditional 410 disablement, and atomic receipt/result/event/admission/queue settlement. 429 retries wait at least one minute; 5xx retries wait at least 15 minutes and honor longer Retry-After. Expiry gates successor creation.
- Seven real local TLS HTTP/2 scenarios passed. Four additional PostgreSQL scenarios cover current/old/refreshed registrations and lost-claim rollback; existing fenced-attempt scenarios also pass.
- Validation: pnpm install, pnpm check, pnpm build, and pnpm database check passed. All 137 workspace tests passed on disposable PostgreSQL 18 UTF-8 using all four integration URLs and pnpm --workspace-concurrency=1 test --no-file-parallelism. Serial execution avoids shared cluster-role collisions between database fixtures.
- Sandbox and production app/device sends have not run. The external provider qualification gate remains open; local protocol fixtures do not prove device delivery.
- Next internal implementation packet is phase 22 FCM HTTP v1. Consumer dispatch stays gated until provider completeness.
