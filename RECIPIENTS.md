# Application recipients

Recipients are application identities within one project/environment. They are separate from Better Auth users. The same external ID can identify different recipients in different environments.

## HTTP operations

The collection is `/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/recipients`.

| Method | Path                          | Result                                         | Permission        |
| ------ | ----------------------------- | ---------------------------------------------- | ----------------- |
| PUT    | Collection                    | Upsert an identity; 200 with its active record | `recipient:write` |
| GET    | Collection                    | Paginated active recipients                    | `recipient:read`  |
| GET    | Collection + `/{recipientId}` | One active recipient                           | `recipient:read`  |
| DELETE | Collection + `/{recipientId}` | Soft-delete one recipient; 204                 | `recipient:write` |

Use an authenticated owner/admin session or a backend service key with the corresponding environment grant. Members can read recipients. Recipient writes do not require recent MFA. Revoked authority is checked on every request. Suspended projects/environments permit reads and deny writes with `AUTH_SCOPE_SUSPENDED`.

Send a JSON body with exactly one `externalId` field for PUT:

```json
{ "externalId": "customer-42" }
```

External IDs contain 1 to 200 Unicode characters, including at least one non-whitespace character. Control characters, NUL, and unpaired surrogates are rejected. Identity is case-sensitive; leading/trailing whitespace is preserved. IDs are opaque application values, with no email parsing or normalization. Bodies must use `application/json` and fit within 4096 bytes.

Concurrent upserts of the same scoped identity return the same recipient UUID. Repeat upserts preserve creation time and refresh update time. Responses contain `id`, `organizationId`, `projectId`, `environmentId`, `externalId`, `createdAt`, `updatedAt`, and `deletedAt` (null for active records).

## Pagination and deletion

Collection GET accepts `limit` (1–100, default 50) and `cursor`. Records are ordered by UUID, and the response is `{ "items": [...], "nextCursor": "..." }`; `nextCursor` is null on the final page. Cursors bind to the recipient collection and its organization/project/environment. A cursor from a service-key collection or another environment returns `RESOURCE_CURSOR_INVALID`. Unknown or duplicate query fields are rejected.

Delete changes one record into a tombstone. Deleted recipients disappear from reads and lists. A repeated delete or read returns `RESOURCE_NOT_FOUND`; upserting its external ID returns `RECIPIENT_DELETED` (409). The external identity remains reserved until the retention/erasure capability is implemented. This operation does not physically erase retained data.

PostgreSQL composite ownership constraints and forced row-level security enforce tenant isolation. Runtime roles cannot change recipient UUIDs, external IDs, or ownership columns, or physically delete rows.

## Endpoint metadata

Endpoint persistence, registration, redacted metadata inspection, and deletion ordering with pending/in-flight delivery belong to phase 14 and subsequent delivery phases. This recipient increment stores no provider tokens, subscriptions, or endpoint secrets. It does not establish push delivery readiness.

## Verification

`apps/server/tests/recipients.integration.test.ts` exercises the built Nitro routes with disposable PostgreSQL 18, authorized sessions and service keys, and generated OpenAPI schema validation. It covers scoped collisions, concurrent/repeat upsert, boundary input, pagination, tenant isolation, immutable ownership, live authority/revocation, suspension, and deletion without resurrection.

Build before running the integration suite:

```bash
pnpm build
TEST_AUTH_DATABASE_URL=postgresql://postgres@localhost:5432/postgres pnpm --filter pipong-server exec vitest run tests/recipients.integration.test.ts
```

The test database account must be able to create databases and roles. Use a disposable PostgreSQL instance: fixtures create and remove the `pipong_*` runtime roles.
