# Projects and environments

Projects belong to an organization. Environments belong to one project in that
organization. Ownership and record IDs are fixed at creation, including at the
PostgreSQL privilege boundary. New IDs are UUIDv7.

Use a Better Auth session cookie for these operations. Owners and admins can
create, rename, and suspend resources after verifying MFA within the last five
minutes. Members can list and read them. Service keys cannot administer or inspect
projects and environments. See [domain authorization](./AUTHORIZATION.md) for
credential, Origin, and session requirements.

## Routes

The project collection is
`/api/v1/organizations/{organizationId}/projects`.
The environment collection is
`/api/v1/organizations/{organizationId}/projects/{projectId}/environments`.

Both collections support the same operations:

- `POST` the collection to create a resource. Returns 201 and its URL in `Location`.
- `GET` the collection to list resources. Returns `{ items, nextCursor }`.
- `GET` a resource URL to read it.
- `PATCH` a resource URL to rename it.
- `POST` a resource URL followed by `/suspend` to suspend it.
- `DELETE` a resource URL returns `409 RESOURCE_DELETION_GATED`. Bounded erasure is
  phase 26 work; this endpoint removes nothing.

Creation and rename accept only a JSON object with a `name` field. The raw name
must contain one to 100 Unicode characters, including at least one non-whitespace
character. NUL and unpaired surrogates are rejected. Leading and trailing
whitespace is removed before storage. Names are case-sensitive and unique within
an organization for projects, or within a project for environments. An existing
name, including a suspended resource's name, returns `409 RESOURCE_NAME_CONFLICT`.
JSON bodies are limited to 4 KiB. Unknown fields, malformed JSON, invalid IDs, and
invalid pagination parameters return 422; unsupported content types return 415.

Resource responses contain `id`, `organizationId`, `name`, `createdAt`,
`updatedAt`, `suspendedAt`, and `deletedAt`. Environments also contain `projectId`.
Timestamps are ISO 8601 strings; unset suspension and deletion timestamps are
null. Renaming changes `updatedAt` and preserves `createdAt` and ownership.

## Pagination and suspension

Lists return at most 100 resources, ordered by UUID, with a default page size of 50. Set `limit` between 1 and 100. Pass `nextCursor` unchanged as `cursor` to
continue. A null cursor marks the end. Cursors are versioned and bound to the
organization and collection, including the project for environment lists.
Invalid or mismatched cursors return `422 RESOURCE_CURSOR_INVALID`. Lists include
suspended resources. Pagination does not provide a snapshot across requests.

Suspension records a timestamp. Repeating it preserves that timestamp. A suspended
project blocks environment creation with `409 RESOURCE_SUSPENDED` and blocks new
work in all its environments. Environment suspension affects that environment;
siblings keep their own state. The authorization boundary rejects notification
submission, delivery redrive, recipient writes, and endpoint writes in suspended
scopes with `409 AUTH_SCOPE_SUSPENDED`. Reads, renames, cancellation, and security
management remain available. There is no resume operation in this phase.

Suspension takes the same resource locks used by authorized work. An operation
that already holds its shared scope locks may finish before suspension commits;
subsequent operations observe suspension. This phase does not implement push
workers or claim to cancel previously accepted provider requests.

## Verification

Run `pnpm migrate` before starting an app with this schema. The migration adds
scoped name constraints and suspension columns and restricts runtime updates to
mutable columns. Existing duplicate scoped names must be corrected before the
migration can succeed; it does not silently rename data.

`apps/server/tests/projects.integration.test.ts` builds a Nitro fixture with the
real routes and checks the generated OpenAPI request and response schemas. It
uses `TEST_AUTH_DATABASE_URL` pointing to a disposable PostgreSQL 18 cluster.
Follow the cluster setup in [authentication](./AUTHENTICATION.md), then run:

```bash
TEST_AUTH_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres pnpm server test
```

The fixture's diagnostic authorization and OpenAPI endpoints are absent from the
normal production build. OpenAPI metadata remains available in development.
