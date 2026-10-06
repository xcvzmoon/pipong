# Human authentication

The API exposes Better Auth at `/api/auth`. PostgreSQL stores accounts, sessions,
organization membership, organization-owned API keys, TOTP data, and rate-limit
counters. The Drizzle adapter runs auth transactions; its tables and migrations
belong to `packages/auth`.

This phase provides the authentication foundation. Operator bootstrap, account
provisioning, invitation acceptance, and privileged-action MFA assurance are the
next phase. There is no public signup or account-provisioning endpoint yet.

## HTTP operations

The handler permits these native operations and rejects every other operation
with `403 AUTH_ENDPOINT_DISABLED`:

- `POST /api/auth/sign-in/email` and `POST /api/auth/sign-out`
- `GET /api/auth/get-session` and `GET /api/auth/list-sessions`
- `POST /api/auth/revoke-session`, `/revoke-sessions`, and `/revoke-other-sessions`
- `POST /api/auth/two-factor/enable`, `/two-factor/get-totp-uri`,
  `/two-factor/verify-totp`, and `/two-factor/verify-backup-code`
- `POST /api/auth/request-password-reset`, `/reset-password`, and
  `/send-verification-email`; `GET /api/auth/verify-email` and
  `/api/auth/reset-password/:token`

Passwords must have at least 12 characters. Login requires a verified email.
TOTP enrollment requires the password and a valid code; subsequent login returns
`twoFactorRedirect: true` until the challenge is completed. Backup codes are
issued during enrollment. Requests to trust a device are rejected with
`AUTH_DEVICE_TRUST_DISABLED`; MFA is required on every new sign-in. Previously
issued signed trust cookies are revoked server-side when presented at login. Disabling MFA and regenerating backup codes remain
blocked until the recovery and assurance policies are implemented.

Public organization mutations, invitation operations, native API-key operations,
and user deletion are blocked. Configuring those plugins does not expose their
mutation routes. Later phases must add the required policy before permitting an
operation.

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

## Authentication email

Auth callbacks await a durable `auth-email` pg-boss job before returning. The
worker sends HTML rendered by Handlebars, plus a text body, through Unemail 0.7's
SMTP driver. Verification and reset callbacks are wired; the invitation callback
is configured for the enrollment phase. Email is authentication infrastructure,
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
namespace. It writes an ignored reference schema to
`packages/auth/tooling/auth-schema.generated.ts` without opening a database
connection. Apply needed changes to `src/schema.ts`, preserving the UUIDv7
and timestamp helpers and keeping relations in `src/relations.ts`. Then run
`pnpm auth generate` and review the SQL. The adapter and generator use
Drizzle's Relations v2 API, matching the installed Drizzle 1.0 release candidate.

The queue migration contains pg-boss 12.37.0's construction SQL and the fixed mail
queue policy. Its standalone transaction wrapper is removed because Drizzle owns
the migration transaction. To regenerate that migration before it is deployed:

```sh
pnpm --filter @pipong/auth exec node tooling/generate-mail-queue.ts migrations/20261006135512_auth_mail_queue
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
existing Pipong roles. Run persistence integration tests in `@pipong/auth` separately with
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
It applies the database foundation before the auth package’s migration history.
Auth owns its schema, relations, adapter, mail queue runtime, and generation tools;
the database package supplies pools and shared schema helpers.

Environment references: [auth package](packages/auth/.env.example),
[API runtime](apps/server/.env.example), and [worker runtime](apps/worker/.env.example).
Package examples document settings; package `.env` files are not loaded automatically.
