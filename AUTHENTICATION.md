# Human authentication

The API exposes Better Auth at `/api/auth`. PostgreSQL stores accounts, sessions,
organization membership, organization-owned API keys, TOTP data, and rate-limit
counters. The Drizzle adapter runs auth transactions; its tables and migrations
belong to `packages/database`.

Operators bootstrap an installation and provision accounts through a local command.
Verified users accept organization invitations through the native auth handler.
Privileged enrollment operations require recent MFA. Public signup and remote
account provisioning remain disabled.

## HTTP operations

The handler permits these native operations and rejects every other operation
with `403 AUTH_ENDPOINT_DISABLED`:

- `POST /api/auth/sign-in/email` and `POST /api/auth/sign-out`
- `GET /api/auth/get-session` and `GET /api/auth/list-sessions`
- `POST /api/auth/revoke-session`, `/revoke-sessions`, and `/revoke-other-sessions`
- `POST /api/auth/two-factor/enable`, `/two-factor/get-totp-uri`,
  `/two-factor/verify-totp`, and `/two-factor/verify-backup-code`
- `POST /api/auth/two-factor/generate-backup-codes` and `/two-factor/disable`
- `POST /api/auth/organization/invite-member`, `/cancel-invitation`,
  `/accept-invitation`, and `/reject-invitation`
- `GET /api/auth/organization/get-invitation` and `/list-user-invitations`
- `POST /api/auth/request-password-reset`, `/reset-password`, and
  `/send-verification-email`; `GET /api/auth/verify-email` and
  `/api/auth/reset-password/:token`

Passwords must have at least 12 characters. Login requires a verified email.
TOTP enrollment requires the password and a valid code; subsequent login returns
`twoFactorRedirect: true` until the challenge is completed. Backup codes are
issued during enrollment. Requests to trust a device are rejected with
`AUTH_DEVICE_TRUST_DISABLED`; MFA is required on every new sign-in. Previously
issued signed trust cookies are revoked server-side when presented at login.
Disabling MFA requires the password and recent MFA. Regenerating backup codes
requires the password and recent MFA; it invalidates all previous codes. Replacing an enrolled TOTP
factor or retrieving its URI also requires recent MFA.

Native organization creation, deletion, and membership changes, native API-key operations,
and user deletion remain blocked. Invitation creation and cancellation require a
verified account, enrolled TOTP, and a successful TOTP or backup-code verification
within five minutes in the current session. Better Auth checks the inviter's
organization permissions. Invitations grant only the member role. The recipient
must sign in with the verified invited email to read, accept, or reject an
invitation. Canceled or expired invitations cannot be accepted.

Auth requests and responses pass through the native handler without reading the
body or rebuilding response headers. Responses have `Cache-Control: no-store`.
Session-cookie caching is disabled so revocation checks read PostgreSQL. Password
reset revokes existing sessions. Callers must preserve every `Set-Cookie` header,
including the session-clearing and challenge cookies returned during MFA login.

An explicit Origin must match `AUTH_BASE_URL`. Better Auth also applies its native
CSRF checks to cookie-authenticated requests. Nitro overwrites the internal client
address header with the connection address. Forwarding headers are ignored, so
clients behind a reverse proxy share that proxy's rate-limit bucket. The global
limit is 100 requests per minute, with Better Auth's stricter login and MFA limits.
A runtime that cannot supply a client address returns
`503 AUTH_CLIENT_ADDRESS_UNAVAILABLE`.

## Local operator enrollment

Build the apps and apply migrations before enrollment:

```sh
pnpm install
pnpm build
pnpm migrate
pnpm worker operator < /secure/bootstrap.json
```

The operator entrypoint is `apps/worker/dist/operator.mjs`. It opens no listener
and accepts JSON only through stdin, with a 16 KiB limit. Command-line arguments
and interactive terminal input are rejected. Supply the normal API configuration,
including `API_DATABASE_URL`, `AUTH_BASE_URL`, and `AUTH_SECRET`; the worker's
restricted database account cannot provision auth users. SMTP configuration is
needed by the running mail worker, which delivers the queued verification email.

Create a private input file with mode `0600` using a secure editor. Bootstrap input:

```json
{
  "action": "bootstrap",
  "name": "Installation owner",
  "email": "owner@example.com",
  "password": "replace-with-a-unique-password",
  "organizationName": "Example",
  "organizationSlug": "example"
}
```

Bootstrap requires an empty account and organization store. It creates one
unverified owner and organization. Concurrent commands serialize on a PostgreSQL
transaction lock; only one succeeds. Account, organization, owner membership,
verification email job, and audit record commit together. An enqueue failure
rolls back enrollment. Bootstrap cannot run again once accounts or organizations
exist.

Provision another account with the same command and this input:

```json
{
  "action": "provision",
  "name": "Organization member",
  "email": "member@example.com",
  "password": "replace-with-a-unique-password"
}
```

Provisioning requires a bootstrapped organization and rejects existing accounts.
It creates an unverified account without organization membership. Output contains
only `userId` and `organizationId` (`null` for provisioning). Errors print a stable
code and exit nonzero. Input passwords and email links are not printed. Remove
input files after provisioning and share credentials through a secure channel.

The owner verifies their email, signs in, enables TOTP, and verifies its first code.
They then invite a provisioned account with `organizationId`, `email`, and
`role: "member"` at `/api/auth/organization/invite-member`. The invitation email
links to `/api/auth/organization/get-invitation?id=...`. The recipient verifies
their own email, signs in, reads the invitation, and submits its `invitationId`
to `/api/auth/organization/accept-invitation`. These are JSON API flows; this
release has no enrollment dashboard.

MFA assurance belongs to the session and expires five minutes after successful
verification. Verify another TOTP code or a single-use backup code to renew it.
Failed verification never renews assurance; logout and session revocation delete
it. Backup-code recovery, invitation creation/cancellation, MFA disable, and backup-code
regeneration write user and session IDs to
`auth.enrollment_audit`, without the codes themselves. The API role can append these records but cannot
update or delete them. Local bootstrap and provisioning
are recorded there too. Recovery with a backup code permits disabling TOTP with the password, then
enrolling and verifying a new factor. Disabling rotates the session and clears
assurance. Privileged enrollment operations stay blocked until the new factor
is verified. Backup-code regeneration requires current assurance. Losing both factors and all
backup codes does not expose a password-only MFA reset.

## Authentication email

Auth callbacks await a durable `auth-email` pg-boss job before returning. The
worker sends HTML rendered by Handlebars, plus a text body, through Unemail 0.7's
SMTP driver. Verification and reset callbacks are wired; the invitation callback
queues organization invitations. Email is authentication infrastructure,
not a notification delivery channel.

Unemail 0.7 has no built-in Handlebars or queue adapter. Pipong renders its template
with Handlebars and uses pg-boss directly. Both runtimes reuse their database pool;
they never apply queue migrations or create queues at startup.

Temporary SMTP failures retry up to five times with exponential backoff, starting
at five seconds and capped at five minutes. Invalid payloads, expired links, and
permanent transport rejections are canceled without retry. Jobs expire after one
minute of active processing; queued mail is retained for at most one hour, and
terminal jobs are deleted after one hour. Queue maintenance runs in the runtime.
The API fails startup if the committed queue schema is missing or incompatible.

SMTP delivery is at least once. A crash after SMTP accepts a message but before
job completion can cause a duplicate. Retries use the same Message-ID, which does
not guarantee recipient-side deduplication. Jobs contain recipients and tokenized
links; restrict database and backup access accordingly. Logs report stable error
codes without mail bodies or SMTP credentials.

Configure the worker's sender and SMTP settings in
[CONFIGURATION.md](./CONFIGURATION.md). TLS is required by default. Plain SMTP is
allowed only with `SMTP_SECURITY=local` and a loopback host for development.

## Schema generation and verification

`pnpm auth generate:schema` uses the pinned Better Auth CLI and a schema-only
configuration with the same plugins, database rate-limit storage, and `auth`
namespace, with `usePlural: true` matching the plural table declarations. It writes an ignored reference schema to
`packages/database/tooling/auth-schema.generated.ts` without opening a database
connection. Apply needed changes to `packages/database/src/auth/schema.ts`, preserving the UUIDv7
and timestamp helpers, plural SQL table names, and keeping relations in `packages/database/src/auth/relations.ts`. Then run
`pnpm database generate:auth` and review the SQL. The adapter and generator use
Drizzle's Relations v2 API, matching the installed Drizzle 1.0 release candidate.

The queue migration contains pg-boss 12.37.0's construction SQL and the fixed mail
queue policy. Its standalone transaction wrapper is removed because Drizzle owns
the migration transaction. To regenerate that migration before it is deployed:

```sh
pnpm --filter @pipong/database exec node tooling/generate-mail-queue.ts migrations/auth/20261006135512_auth_mail_queue
```

Do not regenerate or edit an applied migration. Future upgrades require a new
reviewed migration and runtime compatibility checks.

Build before running the HTTP integration tests. They launch the built API and
worker against a disposable PostgreSQL 18 cluster with trust authentication and
an administrator named `postgres`, plus a local SMTP capture server:

```sh
pnpm install
pnpm build
TEST_AUTH_DATABASE_URL=postgres://postgres@127.0.0.1:55441/postgres pnpm test
pnpm check
```

The suite creates and removes fixed deployment roles. Use a fresh cluster with no
existing Pipong roles. Run persistence integration tests in `@pipong/database` separately with
`TEST_DATABASE_URL`; the two suites must not concurrently provision the same roles.
Without the corresponding URL, each integration suite is skipped. Unit tests
still run, but they do not establish runtime correctness.

Auth mail modules live under `packages/auth/src/mail/`. Configuration, queue
payload validation, rendering, SMTP transport, and worker processing are separate.
The renderer uses an isolated Handlebars environment and compiles the bundled
`.hbs` template once. tsdown and Nitro load `.hbs` imports as text; deployed
artifacts embed the template without runtime file reads. Vitest uses a text loader
for the same source file. The worker bundles `@pipong/auth`, including its template.
Recipient values remain escaped in HTML.

Apply all persistence migrations with `pnpm migrate` from the repository root.
The database package applies `migrations/foundation/` before `migrations/auth/`,
using the existing shared PostgreSQL migration history. It owns schemas, relations,
clients, SQL operations, queue database setup, and migration tooling. Auth owns the
Better Auth adapter, policy, schema-generator configuration, and email delivery.
Enrollment shares one database transaction across Better Auth, auditing, and
queued mail.

Environment references: [auth package](packages/auth/.env.example),
[API runtime](apps/server/.env.example), and [worker runtime](apps/worker/.env.example).
Package examples document settings; package `.env` files are not loaded automatically.

Organization erasure uses the owner-only [domain DELETE operation](./ERASURE.md).
Native invitation operations hold an organization lifecycle lock and deny disabled
or deleted organizations. Invitation creation requires an explicit organization ID.
Organization cleanup preserves human accounts and sessions shared with other tenants.
