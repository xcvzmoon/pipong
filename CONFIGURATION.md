# Runtime configuration

The API and worker validate their own settings when they start. Invalid settings stop startup with `API_CONFIG_INVALID` or `WORKER_CONFIG_INVALID`; the message names affected environment variables and never prints their values.

## API

| Variable                 | Required | Default | Purpose                                                                                                                                                               |
| ------------------------ | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_BASE_URL`          | Yes      |         | Canonical public HTTP origin used by authentication. HTTPS is required except for HTTP on `localhost`. Paths, credentials, query strings, and fragments are rejected. |
| `AUTH_SECRET`            | Yes      |         | Secret used by the authentication service. Supply at least 32 characters through the deployment secret manager.                                                       |
| `CREDENTIAL_KEYRING_REF` | Yes      |         | Operator controlled reference to the credential encryption keyring. Key material itself is not read from this setting.                                                |
| `API_DATABASE_MAX_POOL`  | No       | `8`     | API process database pool budget, from 1 to 100.                                                                                                                      |

`API_DATABASE_URL` is read and validated inside the database package. The API calls `useApiDb()` without passing connection settings. The database package also owns pool-budget validation.

The API and worker budgets are applied independently to node-postgres pools. Connection and idle timeouts are configurable independently for each role. Startup verifies the runtime identity and rejects unsafe database privileges. Both apps drain their pools on shutdown.

## Worker

| Variable                   | Required | Default      | Purpose                                                                                                |
| -------------------------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `CREDENTIAL_KEYRING_REF`   | Yes      |              | The same operator managed keyring reference used by API processes.                                     |
| `WORKER_DATABASE_MAX_POOL` | No       | `12`         | Worker process database pool budget, from 1 to 100. This budget is independent of the API pool budget. |
| `APNS_ENVIRONMENT`         | No       | `production` | APNs target environment: `production` or `sandbox`.                                                    |
| `FCM_PROJECT_ID`           | No       |              | Explicit Firebase target project identifier.                                                           |
| `WEB_PUSH_SUBJECT`         | No       |              | VAPID contact subject: a `mailto:` email address or an HTTPS URL without credentials or a fragment.    |

Provider credentials remain tenant credential records and are not process environment settings. The worker currently validates these settings but does not start provider adapters in this phase.

For local development, set values in your shell or an ignored `.env` file. Do not put real secrets in `.env.example` or command history. The API and worker require their own configuration even when started from the same checkout.

## Database setup

Use PostgreSQL 18 and a dedicated database. As its administrator, run `packages/database/provision.sql` once with `psql -v ON_ERROR_STOP=1 -v DBNAME=pipong -d pipong -f packages/database/provision.sql`. The script creates three login roles; assign passwords through your secret provisioning process before deploying. It revokes public schema creation and database creation/temporary-table privileges from PUBLIC. Do not run it against a database shared with another application.

| Role              | Schema access                                                  | DDL             |
| ----------------- | -------------------------------------------------------------- | --------------- |
| `pipong_migrator` | Owns `auth`, `app`, `pgboss`, and `pipong_migrations`          | Migrations only |
| `pipong_api`      | Read/write tables and sequences in `auth`, `app`, and `pgboss` | Denied          |
| `pipong_worker`   | Read/write tables and sequences in `app` and `pgboss`          | Denied          |

Default grants apply to future tables created by `pipong_migrator`. Tenant tables and RLS are introduced in later phases. Queue access prepares both API enqueueing and worker processing; no queue consumers are enabled yet.

Database environment settings are listed in `packages/database/.env.example`. For each role, `MAX_POOL` defaults to 8 (API) or 12 (worker), `CONNECTION_TIMEOUT` defaults to 5000 milliseconds, `IDLE_TIMEOUT` defaults to 30000 milliseconds, and `APPLICATION_NAME` defaults to its PostgreSQL role name. Connection timeouts must be positive; an idle timeout of zero disables idle eviction. `API_DATABASE_USE_QUERY_LOGGER / WORKER_DATABASE_USE_QUERY_LOGGER` defaults to false and enables the cataloged Drizzle query logger through `console.info`. Query logging includes SQL and parameter values.

Drizzle Kit owns schema generation, migration application, and Studio:

- `pnpm database generate` generates reviewed SQL from `src/schema.ts` without requiring database credentials.
- `pnpm database check` validates migration history.
- `pnpm database migrate` applies committed migrations using `drizzle.migrate.config.ts` and `MIGRATION_DATABASE_URL`.
- `pnpm database studio:api` selects `drizzle.api.config.ts` and the API URL.
- `pnpm database studio:worker` selects `drizzle.worker.config.ts` and the worker URL.

All configs share the same schemas, migration folder, and migration history. API and worker configs select credentials for inspection; they do not create separate databases or migration histories. The initial snapshot records the existing `app`, `auth`, and `pgboss` schemas; application tables are introduced by later capabilities.

Run one migration job at a time before starting either app. The job needs the database package, migration files, and its Drizzle Kit dependencies. No standalone migration executable is built. Drizzle Kit owns migration errors, history, and SQL transaction handling. Administrator role provisioning remains in `provision.sql`; runtime logins retain no schema-change permissions.

Set `API_DATABASE_URL` to the `pipong_api` connection URL and `WORKER_DATABASE_URL` to the `pipong_worker` connection URL. The shared database env validates supplied URLs at import. Each factory or tool requires its own URL; API, worker, and migration settings use the same env module and validators. Each factory opens only its own connection. Never supply migration credentials to an app. PostgreSQL URLs must include a host, username, and database name. In production, local hosts are rejected and `sslmode=require`, `verify-ca`, or `verify-full` is required, preserving the existing database URL policy. Missing required URLs and production URL policy failures report `DATABASE_CONFIG_INVALID`; other environment validation failures come from `@xcvzlabs/env`. Connection or privilege failures report `DATABASE_STARTUP_FAILED`.

Budget connections across all replicas, including migration, operator, and future queue connections. The per-process limits do not impose a cluster-wide budget.

## Database integration tests

Run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres pnpm test` against a disposable PostgreSQL 18 cluster with local trust authentication. The suite creates a temporary database and the fixed deployment roles, then removes them. It requires an administrator named `postgres`; do not point it at a shared or production cluster. Without `TEST_DATABASE_URL`, database integration tests are skipped, while configuration tests still run.

The `@pipong/database` application API exposes `useApiDb` and `useWorkerDb` and its `DatabaseRuntime` type only. Apps receive the Drizzle connection, pool, and shutdown function. The internal env module validates URLs and budgets; the connection module constructs the pool and manages its lifecycle. Provisioning, migration execution, and schema tooling stay inside `packages/database`; application workspaces do not import them.
