# Public API contract

Back to [[plans/01-notification-service/overview]]

## Transport

- One versioned REST API under /api/v1; Better Auth remains under /api/auth with its native contract.
- OpenAPI is the reviewed consumer contract. Valibot schemas and route metadata must describe the same inputs and responses. Do not depend on Nitro's documentation UI as an authorization mechanism.
- Resource roots are /api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}. Cross-scope IDs return a consistent resource-not-found response.

| Resource/action                       | Contract                                                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects and environments             | Create/list/read/update/suspend; destructive deletion through audited lifecycle policy                                                                                                               |
| Service keys                          | Create once-visible secret; list metadata; narrow permissions; rotate/revoke; organization and environment restricted                                                                                |
| Recipients and endpoints              | Upsert recipient by application external ID; register/update/disable endpoints; inspect redacted metadata; bounded recipient deletion                                                                |
| Provider credentials                  | Create a version; inspect metadata; activate/retire; never read secrets back                                                                                                                         |
| POST .../notifications                | Required Idempotency-Key; immediate bounded target list; common content plus typed per-provider overrides; expiry; 202 with notification ID and Location                                             |
| GET .../notifications/{id}            | Aggregate terminal/pending counts and provider-acceptance states, not a claim of device display                                                                                                      |
| GET .../notifications/{id}/deliveries | Cursor-paginated endpoint outcomes and attempts; redact tokens/provider secrets                                                                                                                      |
| POST .../notifications/{id}/cancel    | Idempotent cancellation of work without a committed send-start reservation; return canceled versus in-flight counts. Reserved work may still reach the provider even if physical I/O has not started |
| POST .../deliveries/{id}/redrive      | Privileged, audited fresh attempt lineage after cause correction; never erase original failure history                                                                                               |
| GET .../events and .../events/stream  | Cursor replay and SSE over the same event log and authorization rules                                                                                                                                |

## Submission invariants

- Target either explicit recipient IDs or explicit endpoint IDs, not arbitrary SQL/filters. Resolve and deduplicate inside the acceptance transaction.
- Proposed starting limits: 100 recipient IDs and 1,000 resolved endpoints per submission, 64 KiB HTTP body. These are published protective defaults to benchmark, not demonstrated capacity.
- Empty resolved target set returns 422 no_targets. Exceeding the expansion bound returns 422 target_limit_exceeded before any jobs are created.
- Reject unknown fields, invalid expiry, unsupported provider overrides, and payloads that exceed final provider byte limits. Generic text/data fields do not erase APNs/FCM/Web Push differences.
- Canonical fingerprint includes validated content, targets, expiry, and scope. Same live key+fingerprint returns the original acceptance response, including during concurrency; changed fingerprint returns 409 idempotency_conflict.
- Proposed key retention is 7 days. Once expired, key reuse may create new work; document the window rather than implying permanent deduplication. Revoked authorization does not regain access through a replay.
- The server may attach notificationId/deliveryId in documented application data for consumer-side deduplication. Reject collisions with reserved fields; provider collapse identifiers are not exactly-once delivery.

## Errors and compatibility

- RFC 9457 application/problem+json with stable code, requestId, and safe validation pointers. Use 401, 403, tenant-safe 404, 409, 413, 422, 429 with Retry-After, and 503 for unavailable persistence.
- Cursor pagination has a bounded page size and tenant/filter-bound opaque cursor. No offset pagination for changing delivery/event ledgers.
- No shared/public caching for authenticated responses. Explicit trusted CORS origins; credentialed browser mutations receive CSRF protections.
- Browser SSE uses authorized same-origin session cookies or an authenticated fetch stream. Standard EventSource cannot set arbitrary bearer headers; never put a service key in the URL.
- Version event envelopes and REST contracts together. Changes that remove/alter semantics require a new API version, not silent compatibility aliases.
