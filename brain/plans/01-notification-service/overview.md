# Notification service implementation plan

## Status and scope

- Proposed architecture, dated 2026-10-05. This is a plan, not an implemented or production-certified service.
- Confirmed: PostgreSQL; native APNs, FCM, Web Push; organizations own projects, environments, and application recipients; API, workers, and operator tooling; SSE delivery updates for integrators.
- Recipients are not Better Auth users. No dashboard, inbox/read state, WebSockets, GraphQL, RPC, email/SMS delivery, campaign builder, arbitrary segmentation, or workflow engine in this release.
- Administrative email for account verification/recovery/invitations is authentication infrastructure, not a notification channel.
- Scope is a bounded immediate-send service with expiration, cancellation of pending work, status inspection, and audited recovery. Scheduled campaigns and unbounded broadcast require a separate product decision.

## Repository baseline

- Root is a Nitro v3 starter with one route, no notification implementation or database/auth dependencies. Node 24 and pnpm 12.6.0 are already declared.
- Nitro is currently a beta dependency. Pin the tested version and record a compatibility matrix before release; framework choice does not establish production readiness.
- No brain vault existed. The two linked principles restate supplied repository rules, not historical project decisions.

## Decisions and alternatives

- Follow [[principles/smallest-complete-design]]: REST + OpenAPI instead of REST/GraphQL/RPC together. REST suits heterogeneous native clients, explicit idempotency, status resources, and common operational tooling. GraphQL would add query-cost and resolver-authorization work; RPC would favor a narrower client ecosystem. Add another transport only for a demonstrated consumer need.
- Use a thin pnpm workspace with apps/server, apps/worker, and packages/service. The user selected both deployables under apps/ and src/ within each app. Move the existing Nitro application into apps/server with serverDir ./src; root owns workspace tooling, catalogs, lockfile, documentation, and release orchestration. Do not create packages per provider or utility.
- Node server deployment only for the supported release. Edge/serverless presets are not interchangeable with long-lived PostgreSQL connections, APNs HTTP/2 pools, workers, and SSE.
- PostgreSQL 18 + Drizzle/node-postgres + pg-boss. Compared with Redis/BullMQ, this avoids a second required stateful service. Compared with hand-written queue leases, pg-boss removes queue machinery. Enqueue through its documented Drizzle transaction adapter, not an application/queue dual write.
- Better Auth organization plugin manages people and membership. Application authorization and database isolation remain Pipong responsibilities. Use @better-auth/api-key organization-owned keys with Pipong project/environment grants; pin compatible auth/plugin/adapter versions and prove revocation.
- SSE is a delivery-observation interface, not a fourth background push provider. Durable event rows support replay; PostgreSQL notifications are only optional wakeups. No WebSockets without bidirectional requirements.
- Follow [[principles/prove-boundaries]]: tenant-isolation, queue-rollback, crash, and real-device checks are release gates, not a last-phase cleanup exercise.

## Plan map

- [[plans/01-notification-service/architecture]]
- [[plans/01-notification-service/workspace-relocation]]
- [[plans/01-notification-service/data-and-isolation]]
- [[plans/01-notification-service/api-contract]]
- [[plans/01-notification-service/delivery-semantics]]
- [[plans/01-notification-service/providers]]
- [[plans/01-notification-service/security-and-operations]]
- [[plans/01-notification-service/verification]]
- [[plans/01-notification-service/phases]]
- [[plans/01-notification-service/sources]]

## Implementation rules

- Invoke execute, nitro, ts-best-practices, pnpm, testing/vitest, quality, and unslop for the matching work. Use review/security-reviewer for authorization and release gates.
- Each phase names at most three primary files and five behavioral scenarios. Schema generation, lockfile updates, and documentation updates belong to the capability that requires them. Split any phase that grows beyond that boundary.
- Phases are internal integration increments, not public readiness claims. No published stub APIs or fake provider implementations. The release is complete only when every required gate passes.
- Run pnpm install before the first typecheck, then pnpm check, pnpm test, pnpm build, and the applicable runtime smoke. Keep CHANGELOG.md out of formatting.
