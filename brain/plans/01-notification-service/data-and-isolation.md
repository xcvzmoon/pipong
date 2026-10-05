# Data ownership and isolation

Back to [[plans/01-notification-service/overview]]

## Ownership

- Organization is the tenant. Project identifies an application. Environment is an explicit project-owned boundary such as development or production; APNs sandbox/production is still separate provider metadata.
- Better Auth users/accounts/sessions are global human identities. Its organization/member/invitation tables establish administrative membership, not recipient identity.
- Recipient external IDs are unique within a project/environment, never globally. Each recipient may have multiple installations/endpoints.

| Application record              | Essential fields/invariants                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project / environment           | Organization ownership; environment belongs to exactly one project; suspended/deleted state                                                                  |
| Service-key binding             | Organization-owned auth key ID, project/environment restriction, permissions, expiry/revocation; no plaintext key                                            |
| Recipient / endpoint            | Tenant scope, external ID, provider discriminant, installation identity, encrypted token/subscription, endpoint generation, active/disabled state            |
| Provider credential version     | Tenant scope, provider/app identity, version, encrypted secret, activation/retirement; public metadata only in reads                                         |
| Notification                    | Tenant scope, immutable validated payload, target snapshot, expiry, cancellation marker, aggregate counters                                                  |
| Delivery / attempt              | One unique notification+endpoint delivery; endpoint/credential generation; current attempt/fence; provider acceptance ID; categorized outcome and retry time |
| Idempotency record              | Environment+operation+key uniqueness, canonical request fingerprint, original response, expiry                                                               |
| Delivery event / stream counter | Environment-scoped commit-ordered cursor; minimal authorized event body; retention watermark                                                                 |
| Audit / quota records           | Actor+scope+action+resource; shared admission/concurrency state; no credentials or message bodies                                                            |

## Database enforcement

- Carry organizationId, projectId, and environmentId on delivery-domain rows. Composite unique/foreign keys enforce matching ownership, including credential and endpoint references.
- Use application authorization plus RLS on tenant-domain tables, with both USING and WITH CHECK. FORCE ROW LEVEL SECURITY; runtime roles are not owners, superusers, or BYPASSRLS.
- Tenant context is transaction-local, set only after validating authority. Missing context fails closed. Never session-level SET on a pooled connection.
- RLS is defense against missing predicates, not a sandbox for arbitrary SQL under a role that can choose tenant context. SQL injection prevention and authorization remain mandatory.
- Better Auth's global identity schema and pg-boss operational schema have explicit, separate privileges rather than applying a tenant policy that breaks their cross-organization work. No tenant-facing route directly exposes either schema.
- Auth/database roles, application roles, queue roles, and migration ownership get a documented grant matrix. The API key lookup may use the auth pool before a tenant transaction; application data stays behind tenant-scoped access.
- Cross-tenant uniqueness/FK errors must not reveal whether another tenant has a token or identifier. Uniqueness for endpoints is scoped to provider app identity/environment.

## Lifecycle and races

- Endpoint registration is trusted-backend-only in this release. Customer applications verify their recipient identity, then call Pipong. Never embed a service key in a native app or browser.
- Re-registration increments endpoint generation. An old provider failure may disable only the exact generation it targeted. Unsubscribe/deletion blocks work without a committed send-start reservation; reserved work is in-flight even before the network request begins.
- Pin credential version for each delivery; clients are keyed by tenant, provider app, environment, and version. Rotation retires a version only after pending work drains or is deliberately rebound and audited.
- Tenant/project deletion first suspends new submissions and send-start reservations, cancels pending work, then executes bounded erasure. Serialize status changes with reservation checks in a consistent lock order. Already reserved/submitted external push cannot be reliably recalled; preserve bounded in-flight settlement without recreating erased secrets. Gate all Better Auth organization deletion paths against this policy.
- Keep idempotency for at least the published retry window even if notification bodies are removed. Separate short-lived payload/event retention from longer security-audit retention.
