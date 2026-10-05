# Runtime architecture

Back to [[plans/01-notification-service/overview]]

## Deployables

| Unit             | Responsibility                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| apps/server      | Nitro; Better Auth handler; tenant-aware REST; request validation; atomic notification submission; status/event reads; SSE           |
| apps/worker      | pg-boss consumers; provider calls; delivery result commits; crash recovery; bounded retention and operator jobs                      |
| packages/service | Explicit subpath exports for schemas, auth/authorization, PostgreSQL repositories, queue integration, delivery policy, and providers |
| PostgreSQL       | Auth records through the Better Auth Drizzle adapter, tenant data, delivery ledger, replay events, quotas, and pg-boss schema        |

- Move the existing Nitro application into apps/server, including nitro.config.ts, its tsconfig.json, server/, index.html, and public/. Keep serverDir as ./server relative to apps/server, so handlers live in apps/server/server/api and middleware in apps/server/server/middleware.
- Each app owns its package manifest, development/build/start commands, configuration, and output. apps/server/.output is the Nitro artifact; the worker artifact stays separate. Root owns workspace scripts, catalogs/lockfile, lint/format configuration, integration tests, CI, and documentation.
- Use workspace package exports for shared service imports; the server's ~/* alias resolves inside apps/server, not the repository root. No cross-app source imports or root Nitro config/route compatibility shims.
- No application-wide singleton containing every concern. API imports only request-side subpaths; worker imports delivery-side subpaths. Provider credentials and clients never enter a browser bundle.
- Same source/version can produce API and worker targets in one non-root container image. Run separate commands/containers; scale their replicas independently.
- Production requires PostgreSQL, a TLS ingress, protected secret injection, and public outbound provider access. No required Redis, Kafka, Kubernetes, or commercial service beyond the external push providers.

## Send path

1. Authenticate an administrator or scoped organization service key; authorize the explicit project/environment.
2. Validate the normalized request and provider-specific payloads with Valibot. Resolve a bounded, deduplicated snapshot of active endpoints.
3. In one tenant transaction, reserve idempotency/quota, persist notification and deliveries, append an acceptance event, and enqueue pg-boss jobs using the same Drizzle transaction.
4. Return 202 only after commit. Rollback produces neither an accepted notification nor runnable jobs.
5. A worker loads delivery/endpoint/credential versions, checks scope/status, and records an attempt plus logical send-start reservation under a consistent lock order shared with cancellation/suspension/disable. Commit makes it in-flight; release the transaction before network I/O.
6. Call the selected native provider with a bounded deadline. Finalize result, delivery state, event, and claim-aware queue settlement/retry scheduling atomically in a short transaction. A lost pg-boss claim must roll back those writes, not complete a newer worker's claim.
7. SSE readers query authorized durable events by cursor. Status APIs remain usable without an open stream.

## Queue boundaries

- Provision pg-boss schema/queues using a controlled migration command. Disable automatic DDL for ordinary API/worker startup.
- Job payloads contain tenant scope and delivery identifiers, not secrets or full notification bodies. Re-load and verify the matching database scope; job data alone is not authorization.
- Durable queues are per provider, with organization grouping and measured distributed concurrency limits. Do not create a queue for every recipient.
- Pool budgets account for API replicas, worker replicas, auth access, queue maintenance, and dedicated SSE LISTEN connections if used. No per-SSE-client database connection or long-lived transaction.
- pg-boss handles durable claims/recovery. Application code owns notification states and provider retry classification. See [[plans/01-notification-service/delivery-semantics]] for avoiding stacked retry policies.

## Evolution triggers

- Add Redis/broker only after measured queue/fanout or SSE wakeup pressure exceeds the PostgreSQL design's envelope.
- Add a dashboard, SDK distribution, in-app inbox, SSO/SCIM, or deployment isolation as separately scoped capabilities. Do not claim them for this release.
