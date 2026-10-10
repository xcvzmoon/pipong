# Organization service keys

Service keys authenticate trusted backend integrations. Each key belongs to an
organization and has one fixed project/environment grant. A key remains valid
when its creator leaves the organization. Never embed it in a browser or native
application.

Owners and admins manage keys through a Better Auth session cookie. Issuance,
rotation, and revocation require MFA verified within the last five minutes in
that session. Listing metadata does not require recent MFA. Members and service
keys cannot inspect or manage keys. Cookie mutations require the trusted Origin;
see [domain authorization](./AUTHORIZATION.md).

## Routes

The collection is
`/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/service-keys`.

- `POST` the collection to issue a key. Returns 201 with `{ key, metadata }`.
- `GET` the collection to list metadata. Returns `{ items, nextCursor }`.
- `POST /{keyId}/rotate` to replace a live key. Returns 201 with
  `{ key, metadata, previousKeyExpiresAt }` for the replacement.
- `POST /{keyId}/revoke` to disable a key. Returns `{ id, revoked: true }`.
  Repeating revocation succeeds without adding another revocation audit.

Issuance accepts exactly these fields:

```json
{
  "name": "Production backend",
  "actions": ["notification:read", "notification:send"],
  "expiresIn": 2592000
}
```

`expiresIn` is an integer number of seconds, between 60 and 31,536,000 (365 days).
It is required; keys cannot have an unlimited lifetime. Names follow the same
one-to-100-character validation and trimming as
[projects and environments](./PROJECTS.md). Names need not be unique.

`actions` must contain one to nine unique entries from:

- `recipient:read`, `recipient:write`
- `endpoint:read`, `endpoint:write`
- `notification:read`, `notification:send`, `notification:cancel`
- `delivery:read`, `event:read`

Unknown fields, duplicate actions, unsupported permissions, invalid lifetimes,
and malformed JSON return `422 SERVICE_KEY_INPUT_INVALID`. Bodies are limited to
4 KiB; oversized bodies return 413 and non-JSON content types return 415.
Organization, project, environment, and actions cannot be changed after issuance.
Issue a separate key when an integration needs a different grant.

## Secrets and metadata

The full `pipong_` secret appears only in a successful issuance or rotation
response. Store it securely before discarding that response. If the response is
lost after commit, list metadata, revoke the new key, and issue another. There is
no secret recovery endpoint or issuance idempotency contract.

Only the hash is stored. Listing never selects hashes or secret fragments.
Metadata contains `id`, `organizationId`, `projectId`, `environmentId`, `name`,
`actions`, `enabled`, `expiresAt`, `createdAt`, and `rotatedAt`. Timestamps are ISO
8601 strings. A rotated key's `rotatedAt` is set even while overlap remains;
expiry must be checked separately from `enabled`.

Lists include revoked and expired keys. The default page size is 50, with a
maximum of 100. Use `limit` and pass `nextCursor` unchanged as `cursor`. Cursors
are bound to the full environment scope. A null cursor marks the end; pagination
does not preserve a snapshot across requests.

Send credentials in `Authorization: Bearer <key>` or `X-API-Key`. Newly issued
keys have a shared PostgreSQL rate limit of 100 authentication attempts per
60-second window. Throttling returns `429 AUTH_KEY_RATE_LIMITED` with
`Retry-After` in seconds. A valid but unbound key cannot authorize domain work.

## Rotation and revocation

Rotation accepts exactly:

```json
{
  "expiresIn": 2592000,
  "overlapSeconds": 300
}
```

`overlapSeconds` is required and must be an integer from zero to 86,400. Zero
ends the old key's authority immediately. Positive overlap lets both keys work
until `previousKeyExpiresAt`, capped by the old key's existing expiry. The
replacement receives the same name and immutable grant. Its lifetime starts at
issuance. Choose overlap shorter than the replacement lifetime.

Each key can be rotated once. Concurrent attempts produce one replacement;
later attempts return `409 SERVICE_KEY_ALREADY_ROTATED` while the old key is
still live. Expired or revoked keys return `409 SERVICE_KEY_INACTIVE`. A missing
key or a key in another environment returns `404 SERVICE_KEY_NOT_FOUND` after
scope authorization.

Deploy the replacement credential to integrations during overlap, verify their
requests, then revoke the old key if it must stop before its cutoff. Revocation
only affects the selected key; it does not revoke a replacement or earlier keys.

Issuance commits the auth key, grant, and audit together. Rotation additionally
retires the old key in that transaction. Revocation waits for domain operations
that already hold authority locks. Once it commits, subsequent operations on
all replicas are denied. Operations authorized before revocation may finish.
Security management remains available in suspended environments.

Expired and revoked metadata is retained; the auth adapter disables the plugin's
automatic key deletion. Lifecycle audits record the human actor, session, scope,
key ID, and replacement ID without credential material. Runtime privileges make
grants immutable and audits append-only. The worker clears scoped key hashes and metadata during
[erasure](./ERASURE.md) and removes key audits after 90 days.

Native `/api/auth/api-key/*` operations remain disabled so they cannot bypass
MFA, grant binding, or lifecycle audit policy.

## Verification

Apply the database migrations with `pnpm migrate` before starting the updated
server. The migration constrains stored grant actions, restricts grant updates,
and adds rotation state and audit persistence. Existing invalid grants must be
corrected before migration; it does not silently broaden or repair permissions.

`apps/server/tests/service-keys.integration.test.ts` builds the real Nitro routes
and validates their generated OpenAPI request and response schemas. It runs two
server processes against disposable PostgreSQL 18 and covers tenant scope,
role/MFA denial, expiry units, overlap, revocation, creator departure, immutable
grants, rollback, and concurrent rotation. Follow the cluster setup in
[authentication](./AUTHENTICATION.md), then run:

```bash
TEST_AUTH_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres pnpm server test
```

The diagnostic authorization route and runtime OpenAPI endpoint exist only in
the test fixture. Recipient and delivery operations are later implementation
phases; issuing a key does not enable an unfinished provider path.
