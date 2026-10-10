# Runtime configuration

The API and worker validate their own settings when they start. Invalid settings stop startup with `API_CONFIG_INVALID` or `WORKER_CONFIG_INVALID`; the message names affected environment variables and never prints their values.

## API

| Variable                     | Required | Default | Purpose                                                                                                                                                               |
| ---------------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_BASE_URL`              | Yes      |         | Canonical public HTTP origin used by authentication. HTTPS is required except for HTTP on `localhost`. Paths, credentials, query strings, and fragments are rejected. |
| `AUTH_SECRET`                | Yes      |         | Secret used by the authentication service. Supply at least 32 characters through the deployment secret manager.                                                       |
| `CREDENTIAL_KEYRING_REF`     | Yes      |         | Absolute path to an operator-owned JSON encryption keyring. See [provider credentials](./CREDENTIALS.md).                                                             |
| `WEB_PUSH_EGRESS_POLICY_REF` | No       |         | Absolute path to an operator-owned Web Push destination policy. Omit for public HTTPS defaults. See [Web Push egress](./EGRESS.md).                                   |
| `API_DATABASE_MAX_POOL`      | No       | `8`     | API process database pool budget, from 1 to 100.                                                                                                                      |

`API_DATABASE_URL` is read and validated inside the database package. The API calls `useApiDb()` without passing connection settings. The database package also owns pool-budget validation.

The API and worker budgets are applied independently to node-postgres pools. Connection and idle timeouts are configurable independently for each role. Startup verifies the runtime identity and rejects unsafe database privileges. Both apps drain their pools on shutdown.

## Worker

| Variable                     | Required     | Default      | Purpose                                                                                                |
| ---------------------------- | ------------ | ------------ | ------------------------------------------------------------------------------------------------------ |
| `CREDENTIAL_KEYRING_REF`     | Yes          |              | The same absolute keyring file path used by API processes.                                             |
| `WORKER_DATABASE_MAX_POOL`   | No           | `12`         | Worker process database pool budget, from 1 to 100. This budget is independent of the API pool budget. |
| `APNS_ENVIRONMENT`           | No           | `production` | APNs target environment: `production` or `sandbox`.                                                    |
| `FCM_PROJECT_ID`             | No           |              | Explicit Firebase target project identifier.                                                           |
| `PUSH_DELIVERY_ENABLED`      | No           | `false`      | Set to `true` to start all three push consumers for qualification or an exercised deployment.          |
| `WEB_PUSH_EGRESS_POLICY_REF` | No           |              | Absolute path to the operator-owned Web Push destination policy; omitted uses public HTTPS defaults.   |
| `WEB_PUSH_SUBJECT`           | When enabled |              | VAPID contact subject: a `mailto:` email address or an HTTPS URL without credentials or a fragment.    |

Provider credentials remain tenant credential records and are not process environment settings. Push delivery stays disabled unless `PUSH_DELIVERY_ENABLED=true`; enabling it requires `WEB_PUSH_SUBJECT`. APNs environment and Firebase target project come from each immutable tenant credential and endpoint binding.

Each enabled worker runs one send at a time per provider. Claims pass the database-wide provider and tenant budgets; increasing worker count does not bypass them. The worker reloads its encryption keyring before each claim. An unreadable keyring stops new claims; sender exceptions become ambiguous attempts with bounded application retries. Database failures leave claims for queue recovery. Shutdown stops polling and drains current sends before closing provider clients and the database. Live-device and capacity qualification remain open.

For local development, set values in your shell or an ignored `.env` file. Do not put real secrets in `.env.example` or command history. The API and worker require their own configuration even when started from the same checkout.

## Database setup

Use PostgreSQL 18 and a dedicated database. As its administrator, run `packages/database/provision.sql` once with `psql -v ON_ERROR_STOP=1 -v DBNAME=pipong -d pipong -f packages/database/provision.sql`. The script creates three login roles; assign passwords through your secret provisioning process before deploying. It revokes public schema creation and database creation/temporary-table privileges from PUBLIC. Do not run it against a database shared with another application.

| Role              | Schema access                                                  | DDL             |
| ----------------- | -------------------------------------------------------------- | --------------- |
| `pipong_migrator` | Owns `auth`, `app`, `pgboss`, and `pipong_migrations`          | Migrations only |
| `pipong_api`      | Read/write tables and sequences in `auth`, `app`, and `pgboss` | Denied          |
| `pipong_worker`   | Read/write tables and sequences in `app` and `pgboss`          | Denied          |

Default grants apply to future tables created by `pipong_migrator`. Tenant tables and RLS are introduced in later phases. API callbacks enqueue authentication email, and the worker processes the `auth-email` queue. Push delivery consumers remain disabled.

Database environment settings are listed in `packages/database/.env.example`. For each role, `MAX_POOL` defaults to 8 (API) or 12 (worker), `CONNECTION_TIMEOUT` defaults to 5000 milliseconds, `IDLE_TIMEOUT` defaults to 30000 milliseconds, and `APPLICATION_NAME` defaults to its PostgreSQL role name. Connection timeouts must be positive; an idle timeout of zero disables idle eviction. `API_DATABASE_USE_QUERY_LOGGER / WORKER_DATABASE_USE_QUERY_LOGGER` defaults to false and enables the cataloged Drizzle query logger through `console.info`. Query logging includes SQL and parameter values.

Drizzle Kit owns schema generation, migration application, and Studio:

- `pnpm database generate` generates foundation/application SQL from `src/schema.ts`; `pnpm database generate:auth` generates auth SQL from `src/auth/schema.ts`. Neither requires database credentials.
- `pnpm database check` validates migration history.
- `pnpm migrate` applies database foundation and auth migrations in order using `MIGRATION_DATABASE_URL`.
- `pnpm database studio:api` selects `drizzle.api.config.ts` and the API URL.
- `pnpm database studio:worker` selects `drizzle.worker.config.ts` and the worker URL.

Database owns both schema sources and the `migrations/foundation/` and `migrations/auth/` folders, with one PostgreSQL migration history. API and worker configs select credentials for inspection; they do not create separate databases or migration histories. The migrations include the schema foundation, generated auth tables, and pg-boss storage with the authentication mail queue. Tenant notification tables are introduced by later capabilities.

Run one migration job at a time before starting either app. The job needs the database package, migration files, and its Drizzle Kit dependencies. No standalone migration executable is built. Drizzle Kit owns migration errors, history, and SQL transaction handling. Administrator role provisioning remains in `provision.sql`; runtime logins retain no schema-change permissions.

Set `API_DATABASE_URL` to the `pipong_api` connection URL and `WORKER_DATABASE_URL` to the `pipong_worker` connection URL. The shared database env validates supplied URLs at import. Each factory or tool requires its own URL; API, worker, and migration settings use the same env module and validators. Each factory opens only its own connection. Never supply migration credentials to an app. PostgreSQL URLs must include a host, username, and database name. In production, local hosts are rejected and `sslmode=require`, `verify-ca`, or `verify-full` is required, preserving the existing database URL policy. Missing required URLs and production URL policy failures report `DATABASE_CONFIG_INVALID`; other environment validation failures come from `@xcvzlabs/env`. Connection or privilege failures report `DATABASE_STARTUP_FAILED`.

Budget connections across all replicas, including migration, operator, and future queue connections. The per-process limits do not impose a cluster-wide budget.

## Database integration tests

Run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres pnpm database test` against a disposable PostgreSQL 18 cluster with local trust authentication. Persistence tests in `@pipong/database` create a temporary database and the fixed deployment roles, then remove them. They require an administrator named `postgres`; do not point it at a shared or production cluster. Without `TEST_DATABASE_URL`, persistence integration tests are skipped, while configuration tests still run.

`@pipong/database` owns pools, typed clients, schemas, relations, SQL operations,
queue database setup, and migrations. Its `./auth` entrypoint provides concrete
enrollment and MFA persistence operations and table metadata for adapter integration.
`@pipong/auth` owns Better Auth setup, its adapter, authentication policy, and email
delivery. Run `pnpm migrate` at the root to apply foundation migrations before auth
migrations.

## Authentication email worker

| Variable         | Required | Default    | Purpose                                                                                           |
| ---------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `AUTH_MAIL_FROM` | Yes      |            | Sender email address                                                                              |
| `SMTP_HOST`      | Yes      |            | SMTP server hostname                                                                              |
| `SMTP_PORT`      | No       | `587`      | SMTP port, from 1 to 65535                                                                        |
| `SMTP_SECURITY`  | No       | `starttls` | `starttls` requires STARTTLS; `tls` uses implicit TLS; `local` permits plaintext only on loopback |
| `SMTP_USER`      | No       |            | SMTP login; supply together with `SMTP_PASSWORD`                                                  |
| `SMTP_PASSWORD`  | No       |            | SMTP password; supply together with `SMTP_USER`                                                   |

Only the worker requires SMTP settings. Invalid settings stop it with
`AUTH_MAIL_CONFIG_INVALID`, without including credentials in the error. For
implicit TLS, set `SMTP_SECURITY=tls` and the provider's port (usually `465`).

The API queues mail through its own pool without an SMTP connection. The worker
uses its pool for queue processing and drains the queue before closing its SMTP
transport and database pool. Queue runtimes cannot migrate or create queues.

See [human authentication](./AUTHENTICATION.md) for enabled routes, queue retry and
retention policy, reverse-proxy rate-limit behavior, and built-runtime tests.

## Environment examples

- [API](apps/server/.env.example) includes auth configuration and the API database connection.
- [Worker](apps/worker/.env.example) includes SMTP, provider settings, and the worker database connection.
- [Auth package](packages/auth/.env.example) lists auth and SMTP settings by consumer.
- [Database package](packages/database/.env.example) lists connection settings by role and the migration URL.

App templates contain only their runtime settings. Package templates are references;
do not inject every package setting into every process. API and worker processes
must not receive the migration credential. Nothing automatically loads the package
`.env` files. Copy the relevant app template to its `.env` for local development;
export migration settings separately before running `pnpm migrate`.
