# Runtime configuration

The API and worker validate their own settings when they start. Invalid settings stop startup with `API_CONFIG_INVALID` or `WORKER_CONFIG_INVALID`; the message names affected environment variables and never prints their values.

## API

| Variable                 | Required | Default | Purpose                                                                                                                                                               |
| ------------------------ | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_BASE_URL`          | Yes      |         | Canonical public HTTP origin used by authentication. HTTPS is required except for HTTP on `localhost`. Paths, credentials, query strings, and fragments are rejected. |
| `AUTH_SECRET`            | Yes      |         | Secret used by the authentication service. Supply at least 32 characters through the deployment secret manager.                                                       |
| `CREDENTIAL_KEYRING_REF` | Yes      |         | Operator controlled reference to the credential encryption keyring. Key material itself is not read from this setting.                                                |
| `API_DATABASE_POOL_MAX`  | No       | `8`     | API process database pool budget, from 1 to 100.                                                                                                                      |

`DATABASE_URL` is validated by the database package and is shared as the connection target. Its URL validation is not repeated by the API config parser.

The API and worker budgets are applied independently to node-postgres pools. Connections time out after five seconds; idle connections close after 30 seconds. Startup verifies the runtime identity and rejects unsafe database privileges. Both apps drain their pools on shutdown.

## Worker

| Variable                   | Required | Default      | Purpose                                                                                                |
| -------------------------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `CREDENTIAL_KEYRING_REF`   | Yes      |              | The same operator managed keyring reference used by API processes.                                     |
| `WORKER_DATABASE_POOL_MAX` | No       | `12`         | Worker process database pool budget, from 1 to 100. This budget is independent of the API pool budget. |
| `APNS_ENVIRONMENT`         | No       | `production` | APNs target environment: `production` or `sandbox`.                                                    |
| `FCM_PROJECT_ID`           | No       |              | Explicit Firebase target project identifier.                                                           |
| `WEB_PUSH_SUBJECT`         | No       |              | VAPID contact subject: a `mailto:` email address or an HTTPS URL without credentials or a fragment.    |

Provider credentials remain tenant credential records and are not process environment settings. The worker currently validates these settings but does not start provider adapters in this phase.

For local development, set values in your shell or an ignored `.env` file. Do not put real secrets in `.env.example` or command history. The API and worker require their own configuration even when started from the same checkout.

## Database setup

Use PostgreSQL 18 and a dedicated database. As its administrator, run `packages/database/provision.sql` once with `psql -v ON_ERROR_STOP=1 -d pipong -f packages/database/provision.sql`. The script creates three login roles; assign passwords through your secret provisioning process before deploying. It revokes public schema creation and database creation/temporary-table privileges from PUBLIC. Do not run it against a database shared with another application.

| Role              | Schema access                                                  | DDL             |
| ----------------- | -------------------------------------------------------------- | --------------- |
| `pipong_migrator` | Owns `auth`, `app`, `pgboss`, and `pipong_migrations`          | Migrations only |
| `pipong_api`      | Read/write tables and sequences in `auth`, `app`, and `pgboss` | Denied          |
| `pipong_worker`   | Read/write tables and sequences in `app` and `pgboss`          | Denied          |

Default grants apply to future tables created by `pipong_migrator`. Tenant tables and RLS are introduced in later phases. Queue access prepares both API enqueueing and worker processing; no queue consumers are enabled yet.

Set `MIGRATION_DATABASE_URL` to the `pipong_migrator` connection URL. Build the worker, then run `pnpm database migrate` once per deployment before starting either app. The worker artifact includes `dist/migrate.mjs` and `dist/migrations/`; deploy the whole directory. The command needs no API/auth/provider configuration, serializes migration runs with a PostgreSQL advisory lock, and always closes its connection. Migration failure returns `DATABASE_MIGRATION_FAILED` without database error details or secrets. Failed migration SQL rolls back; Drizzle's migration bookkeeping schema/table can remain after a failed first run.

Set each app's `DATABASE_URL` to its own role: `pipong_api` for the API and `pipong_worker` for the worker. Never supply migration credentials to an app. PostgreSQL URLs must include a host, username, and database name. In production, local hosts are rejected and `sslmode=require`, `verify-ca`, or `verify-full` is required, preserving the existing database URL policy. Invalid URLs report `DATABASE_CONFIG_INVALID`; connection or privilege failures report `DATABASE_STARTUP_FAILED`.

Budget connections across all replicas, including migration, operator, and future queue connections. The per-process limits do not impose a cluster-wide budget.

## Database integration tests

Run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres pnpm test` against a disposable PostgreSQL 18 cluster with local trust authentication. The suite creates a temporary database and the fixed deployment roles, then removes them. It requires an administrator named `postgres`; do not point it at a shared or production cluster. Without `TEST_DATABASE_URL`, database integration tests are skipped, while configuration tests still run.
