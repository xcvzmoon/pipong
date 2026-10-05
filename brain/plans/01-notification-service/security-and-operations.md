# Security and self-hosted operations

Back to [[plans/01-notification-service/overview]]

## Identity and authorization

- Better Auth organization + @better-auth/api-key + Drizzle adapter, with compatible pinned releases and generated/reviewed schema. Enable documented adapter transactions; do not assume an auth API call shares an enclosing application transaction.
- Owner controls organization lifecycle; admin manages permitted resources; member is operational read-only by default. Domain permissions separately cover send, recipient writes, delivery/event reads, project management, secrets, and keys. No dynamic custom-role engine in this release.
- Verify live membership, organization status, resource ownership, and action on every request. Active organization is a UI preference, not authority. Disable cookie session caching where it delays revocation.
- Service keys have fixed organization-owned configuration, hashed storage, expiry, and relational environment grants. No human-session impersonation. Reject ambiguous cookie+key authentication.
- Gate raw auth-plugin key mutation and organization deletion paths so they cannot bypass Pipong policy. Keys without a committed grant binding fail closed; if auth key creation is not transaction-shareable, return its plaintext only after grant commit and revoke on failure.
- Organization keys survive their creator's departure; that human loses management access. Disabled organizations and revoked/expired keys fail closed, including SSE within the documented recheck interval.

## Operator enrollment

- Default public signup and public organization creation off. Local operator tooling provisions the first account/organization using supported auth APIs and protected stdin, not shell arguments or a bootstrap HTTP endpoint.
- Later enrollment is operator-assisted account provisioning plus verified-email invitations. An organization invitation is not an account-creation flow. Require a working authentication mail sender and document password reset/verification/invitation completion through CLI/API.
- TOTP and recovery codes required for deployment administrators/organization owners before secret/key/ownership operations. No trusted-device bypass initially. Pin and prove server-observed recent completed-MFA assurance; enrollment/fresh password alone is insufficient.
- If the chosen auth release cannot express fresh MFA assurance directly, resolve the supported server hook/assurance-record design during identity implementation before opening privileged endpoints. No client-supplied mfaVerified flag.
- SSO/SAML/SCIM, custom roles, and compliance certification are outside the selected release. They are not implied by the words enterprise-grade.

## Secrets and network

- Encrypt provider credentials, device identifiers, subscription secrets, and retained message bodies using a vetted AEAD primitive. Store key version and authenticated tenant/resource context; keys live outside PostgreSQL, with an operator-controlled keyring and rehearsed rotation/recovery.
- Never log raw payloads, endpoint URLs, API keys, provider keys, passwords, MFA seeds, or recovery codes. Redact error bodies and cap their retained size. Audit privileged actions append-only under restricted write grants; this is not tamper-proof evidence against a database superuser.
- Exact canonical URL/trusted origins, secure cookies, custom-route CSRF protection, no wildcard credentialed CORS, and trusted-ingress forwarded-header handling. No user-controlled callback/redirect/proxy URLs.
- Web Push checks at registration and every connection: HTTPS, no URL credentials/fragments, approved ports, all A/AAAA addresses screened including mapped IPv4, address pinning with correct TLS SNI/Host, no redirects, bounded body/read/total time. Egress firewall/proxy adds defense in depth.
- Operator-owned private-origin/CIDR exceptions and private CA trust are explicit deployment policy, never tenant input. Do not bypass TLS verification.

## Admission and observability

- PostgreSQL-backed atomic limits for organization/key requests, accepted endpoints, pending work, and active provider jobs; enforce across replicas, before fanout commit. Plugin counters alone are not assumed strict quotas. No in-memory-only enterprise rate limit.
- Bound body, fanout, connection pools, provider caches, SSE buffers/streams, retry age/attempts, and retention work. Healthy tenants must make progress while another is throttled.
- Structured request/notification/delivery/attempt correlation; OpenTelemetry traces/metrics. Avoid tenant/recipient IDs as unbounded metrics labels. Protect metrics and diagnostics from public access.
- Separate liveness from readiness. Readiness checks schema/DB access and worker consumer health without probing live provider sends or requiring third-party uptime. Alert on queue age, ambiguous/exhausted work, credential failures, DB/pool pressure, slow SSE, and backup failure.

## Deployment and recovery

- Provide Docker Compose for API, worker, PostgreSQL and example TLS/SSE proxy configuration; one-shot migration and bootstrap commands; secret-file examples; non-root image and read-only filesystem where feasible.
- Run migrations once per deployment under migration authority, not in every replica. API producers do not run queue schedulers/supervisors; worker owns required queue maintenance. Support rolling API/worker drain without accepting work into an incompatible schema.
- Retention defaults proposed: payload/outcomes 30 days, event replay/idempotency 7 days, audit 90 days. Publish erasure behavior and exclusions for backups; align queue retention so it cannot erase live unresolved deliveries.
- PostgreSQL backups plus WAL/PITR, separately protected encryption/auth keys, and restore drill. Provisional operational objectives: RPO <=15 minutes, RTO <=1 hour; measure before advertising support guarantees.
- Document HA requirements, upgrade/rollback boundaries, redrive/cancellation, credential/VAPID rotation, tenant erasure, compromised-key response, and provider egress dependence.
