# Verification and release gates

Back to [[plans/01-notification-service/overview]]

## Baseline and compatibility

- Planning research did not run providers or establish capacity. The starter's current passWithNoTests is not product evidence.
- First gate pins Node 24-compatible runtime/types, Nitro/H3, Better Auth plugins/Drizzle adapter/CLI, pg-boss, and provider packages. Verify Web Request/Response auth cookies, queue transaction adapter, HTTP/2 shutdown, and nondeprecated H3 EventStream against built artifacts.
- Extend existing CI with real PostgreSQL 18, reviewed migrations, API/worker builds, and isolated database fixtures. Turn off passWithNoTests once suites exist; review isolate:false before adding stateful tests. Dependency injection/local protocol fixtures instead of forbidden module mocks.
- Per completed capability: pnpm install before first typecheck; pnpm check, pnpm test, pnpm build; actual API/worker/operator runtime smoke. Generated output and docs must agree with the released contract.

## Security gates

- Two organizations, overlapping external recipient IDs, sibling projects/environments: deny cross-scope routes, nested mismatches, key grants, provider clients, status queries, cursors, SSE, and redrive. Test raw auth-plugin routes as well as custom routes.
- Reused pooled connections after commit/rollback: no leaked tenant context; absent context denies reads/writes; wrong-scope inserts/FKs rejected under actual non-owner roles. Migration runtime DDL denied.
- Removed/demoted user, expired/revoked key, disabled organization, stale active organization, key creator departure, concurrent ownership changes, and orphan key binding follow the documented policy.
- CSRF/CORS/proxy-host tests; all auth cookies preserved; no pre-MFA access to privileged operations; bootstrap local-only/race-safe; verification/invitation/reset/recovery flows actually complete.
- Web Push DNS rebinding, mixed public/private A/AAAA, mapped IPv4, redirects, metadata addresses, TLS failure, proxy DNS, oversized responses, and bounded timeout tested with a controlled transport/network fixture. Allowed public and operator-approved private origins still work.

## Durability gates

- Concurrent identical idempotency requests create one notification and one unique set of deliveries; altered request conflicts; expired key semantics explicit. Rollback at each persistence/enqueue boundary leaves neither accepted work nor jobs.
- Two workers, process kill before send, kill after transmission, acceptance before result commit, DB outage, expired/reclaimed job, and late response: no false success, terminal resends, lost accepted work, or stale-state overwrite; ambiguous duplicate risk remains documented. Reclaim before a replacement application attempt starts; old claim completion must affect zero and roll back result/event/successor writes.
- Provider-specific permanent/transient/429/5xx/error-unit handling; hidden client retries accounted for; retry/cancel/expiry/redrive and endpoint/credential rotation races exercised. Pause after send-start reservation commit and before I/O: cancel/disable/suspend blocks later reservations but reports this one as in-flight.
- Event transaction commit inversion, two API replicas, listener restart/lost wakeup, disconnect/replay, cursor expiry, slow consumers, and stream authorization loss: durable replay has no skipped committed event.
- Restart the complete stack, drain during rolling update, migrate from empty and the preceding supported schema, delete a tenant, rotate secrets, and restore backups+keys into a clean environment.

## Real provider proof

- APNs requires an Apple Developer account/key with correct scope, push-enabled signed app, and instrumented physical devices. Verify sandbox and distribution/TestFlight production separately, including background/alert and endpoint re-registration.
- FCM requires a target project/API/IAM credential, current client FID/registration behavior, and an instrumented Android device with permission/channel setup. Verify project mismatch and registration refresh; do not intentionally flood providers to force quota errors.
- Web Push requires an HTTPS origin, actual service worker/subscriptions/permission, Chromium, Firefox, Safari, and iOS Home Screen app coverage. Test VAPID-bound re-subscription and offline TTL.
- Correlate persisted attempt/provider IDs with client receipt and display observations. Keep server acceptance distinct even when a test device receives it. Local protocol fixtures cannot certify native delivery.
- Missing credentials/client apps/devices block the corresponding production gate, not repository design work. Record exact platform versions, sanitized evidence, failures, and operational prerequisites.

## Provisional measurable envelope

- Benchmark on a documented reference topology: two API replicas, two workers, PostgreSQL 18 (initial reference 4 vCPU/8 GiB), bounded pools, realistic retention volume, TLS ingress, and separate deterministic provider fixtures.
- Initial target: 50 accepted requests/second with two endpoints/request for 30 minutes; acceptance p95 <=250 ms and healthy-queue dispatch p95 <=2 seconds, excluding provider-required retry waits. This is a proposed gate, not measured performance or a hardware recommendation for every installation.
- Also test burst/backlog drain, one 1,000-endpoint request, 1,000 concurrent SSE clients over a bounded number of environments, and noisy-tenant fairness. Report environment count, bytes, memory, CPU, DB waits, and provider latency.
- Proposed API availability objective 99.9% in a qualifying HA deployment; no universal self-hosted SLA or provider/display guarantee. Publish a supported envelope only after measurement.
- Release only when all required functional/security/durability/provider/restore gates pass and installation works from the published artifacts without source checkout.
