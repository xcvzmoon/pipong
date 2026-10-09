# Database

`@pipong/database` owns PostgreSQL environment validation, connection pools,
Drizzle schema definitions and configuration, role provisioning, and migrations.
Applications open a connection by purpose. They do not pass URLs or pool options.

The supported target is PostgreSQL 18 with Node.js 24 and the workspace's pinned
Drizzle and node-postgres dependencies.

## One database, three accounts

All three connection URLs should point to the same database. Their usernames
identify accounts with different permissions; they do not identify three databases.

| Account           | Used by                      | Access after the foundation migration                     |
| ----------------- | ---------------------------- | --------------------------------------------------------- |
| `pipong_api`      | API process                  | Read/write tables in `auth`, `app`, and `pgboss`          |
| `pipong_worker`   | Worker process               | Read/write tables in `app` and `pgboss`; no `auth` access |
| `pipong_migrator` | Deployment migration command | Owns schemas and creates or changes database objects      |

The API handles authentication and accepts notification requests. The worker
processes deliveries. The migrator is an account used by a command that runs and
exits, rather than a continuously running service.

For example, a deployment creates a notifications table using the migrator.
The API then inserts notification requests, and the worker reads them and records
delivery results using their respective accounts.

Runtime accounts have no database CREATE or TEMPORARY privileges and no CREATE
privilege on the public, authentication, application, or queue schemas. They are
not superusers and cannot create databases, create roles, replicate, or bypass RLS.
Startup checks enforce the expected account name and these restrictions.

Both runtime accounts receive table permissions in `app` and `pgboss`. Project
and environment tables additionally enforce tenant scope with `USING`, `WITH
CHECK`, and `FORCE ROW LEVEL SECURITY`. Authentication and queue tables retain
separate grants and do not use application tenant policies.

## Local setup

Run commands from the repository root unless stated otherwise.

1. Install workspace dependencies with `pnpm install`.
2. Create a dedicated PostgreSQL database named `pipong` through your administrator
   connection. Use a database that belongs only to this application.
3. Provision the accounts once:

   ```sh
   psql -v ON_ERROR_STOP=1 -v DBNAME=pipong -d pipong -f packages/database/provision.sql
   ```

   Supply administrator connection settings through your PostgreSQL client
   environment or service configuration. `DBNAME` must match the target database.
   The script creates fixed role names and revokes PUBLIC privileges; it is not
   an idempotent setup script and will fail if the roles already exist.

4. Assign role passwords through your secret provisioning process and configure
   PostgreSQL authentication. The script creates login roles without passwords.
   The example URLs assume local authentication permits connections without a
   password; copying them does not configure PostgreSQL authentication.
5. Copy the environment template and edit it for your installation:

   ```sh
   cp packages/database/.env.example packages/database/.env
   ```

6. Export the migration settings into the command environment, then run
   `pnpm database migrate`. For a local shell file you control, all example values
   can be exported with:

   ```sh
   set -a
   . ./packages/database/.env
   set +a
   pnpm migrate
   ```

The package reads the process environment. It does not load `.env` files itself.
An app runner may have its own environment-file loading behavior; do not assume
that it discovers `packages/database/.env`.

That local shell example also exports the migrator credential. Production app
processes must receive only runtime settings; inject the migration credential
into the deployment job separately. API and worker app settings are documented
in [the workspace configuration guide](../../CONFIGURATION.md), with templates
in [server](../../apps/server/.env.example) and [worker](../../apps/worker/.env.example).

## Environment reference

The complete database template is [.env.example](.env.example). Each runtime role
uses the same suffixes with either `API_DATABASE_` or `WORKER_DATABASE_`.

| Suffix               | API default  | Worker default  | Validation and meaning                                                                             |
| -------------------- | ------------ | --------------- | -------------------------------------------------------------------------------------------------- |
| `URL`                | Required     | Required        | PostgreSQL URL with host, username, and database name; at most 2048 characters                     |
| `MAX_POOL`           | `8`          | `12`            | Maximum connections per pool, integer from 1 to 100                                                |
| `CONNECTION_TIMEOUT` | `5000`       | `5000`          | Connection acquisition timeout in milliseconds, integer from 1 to 2147483647                       |
| `IDLE_TIMEOUT`       | `30000`      | `30000`         | Idle connection timeout in milliseconds, integer from 0 to 2147483647; zero disables idle eviction |
| `APPLICATION_NAME`   | `pipong_api` | `pipong_worker` | Nonempty PostgreSQL connection label, at most 63 characters                                        |
| `USE_QUERY_LOGGER`   | `false`      | `false`         | Boolean flag enabling the Drizzle query logger                                                     |

`NODE_ENV` accepts `development`, `test`, or `production`, and defaults to
`development`. `MIGRATION_DATABASE_URL` is required only by migration tooling.

Environment validation happens at module import. Each supplied URL is validated;
missing URLs are rejected by the factory or tool that needs them. API startup
requires API_DATABASE_URL, worker startup requires WORKER_DATABASE_URL, and
migration tooling requires MIGRATION_DATABASE_URL. All settings share the same
`env.ts` and validators. Configure values before import; changing them later does
not reload the validated configuration.

For `NODE_ENV=production`, all URLs used by the imported environment must include
`sslmode=require`, `verify-ca`, or `verify-full`. The exact hosts `localhost`,
`127.0.0.1`, and `::1` are rejected. This is URL validation, not a connectivity or
certificate test. Configure the TLS mode and certificate trust for your deployment.

Query logging defaults to disabled in the configuration and example templates. It logs SQL and parameter values through `console.info`. Keep it
disabled where parameters contain credentials, recipient details, or message data.
Raw queries made directly through `pool` do not use Drizzle's query logger.

## Application API

The package root exports `useApiDb`, `useWorkerDb`, and `DatabaseRuntime`. Schema helpers use `@pipong/database/helpers`.
Provisioning and migration tooling stay internal.

```ts
import { useApiDb } from '@pipong/database';

const database = await useApiDb();
try {
  await database.pool.query('SELECT 1');
} finally {
  await database.close();
}
```

Use `useWorkerDb()` in a worker. Neither factory accepts configuration arguments,
runs migrations, or creates schemas. Both verify a live database connection and
its role permissions before returning.

| Result member | Purpose                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| `db`          | Drizzle client backed by the runtime pool for queries and transactions            |
| `pool`        | Native node-postgres pool for integrations requiring a pool or checked-out client |
| `close()`     | Ends the pool; returns a promise to await during shutdown                         |

Create one runtime per application process at startup. Every factory call creates
a new pool; there is no singleton or connection cache. Importing the module
validates settings but opens no connection. Auth creates its own typed Drizzle client on the same pool.

Stop accepting requests or jobs before closing the pool. Release checked-out
clients in `finally` blocks so shutdown can finish. Await `close()` once for each
runtime, after in-flight work completes. The server registers it with Nitro's
close hook; the worker closes its runtime after its processing loop stops.

Pool limits are per process. Budget the combined connections across API and
worker replicas, migrations, operator sessions, and future queue integrations.
Separate pools alone do not reserve server capacity or impose a global limit.

## Schema and migration workflow

Schema helpers are available from `@pipong/database/helpers`, adapted from
[open-fms](https://github.com/xcvzmoon/open-fms/tree/main/packages/database/src/helpers).
Use `generateUuid()` for UUIDv7 primary keys and `generateTimestamps()` for
`createdAt`, `updatedAt`, and nullable `deletedAt` columns. All timestamps use
millisecond precision and PostgreSQL `timestamptz`.

`generateTimestampsWithAudit(() => user.id)` adds UUID actor IDs matching Better
Auth's user table. Creation requires an actor and restricts actor
deletion; update and deletion actors are nullable and use `ON DELETE SET NULL`.
The optional second, third, and fourth arguments override those deletion actions.
Omitting the user callback creates actor columns without foreign keys.

UUIDv7 is the convention for new record IDs, including Better Auth's runtime
generator. The UUID default and `updatedAt` update hook execute through Drizzle;
raw SQL must supply IDs and manage update timestamps. Setting `deletedAt` does
not automatically exclude rows from queries. Auth tables use these helpers too. Soft-deletion columns do not change Better
Auth's hard-delete behavior.

Schema authoring and migration files stay in this package. Use the following
workflow when a feature needs database changes:

1. Add Drizzle definitions under `src/schema.ts` for foundation/application storage or `src/auth/schema.ts` for auth storage.
2. Run `pnpm database generate` for foundation/application schemas or `pnpm database generate:auth` for `src/auth/schema.ts` to generate SQL and snapshots.
3. Review the generated SQL. Include explicit SQL for grants and operations that
   are not represented by the schema generator.
4. Run `pnpm database check`, then test the migrations on a disposable database.
5. Commit reviewed migration files with the feature through your normal workflow.
6. Apply them once during deployment with `pnpm database migrate`, before starting
   application processes that depend on the new schema.

Generation needs no live connection or database credentials. Migration application
uses `MIGRATION_DATABASE_URL` through Drizzle Kit. The same migration history
serves both API and worker connections; it is stored in the `pipong_migrations`
schema. Drizzle Kit tracks applied migrations, so a repeated migration command
applies only pending work.

Serialize deployment migration jobs. This package adds no migration locking or
custom rollback runner around Drizzle Kit. For a migration failure, inspect the
reported SQL and database state before retrying. Restoring a previous application
build does not automatically reverse database changes.

The foundation migration creates `auth`, `app`, and `pgboss` with migrator
ownership and sets default privileges for future tables and sequences created
by `pipong_migrator`. Objects created by another account do not inherit those
account-specific default grants. Sequence access is USAGE and SELECT.

`provision.sql` is an administrator operation that creates accounts before
migration execution. It stays separate because the migrator cannot create roles.
Ordinary application startup performs neither provisioning nor migration work.

## Drizzle configs

| File                             | Commands                 | Responsibility                                                                         |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `drizzle.config.ts`              | `generate`, `check`      | Shared dialect, schema source, migration directory, and history schema; no credentials |
| `drizzle.auth.config.ts`         | `generate:auth`, `check` | Auth schema source and migration directory; no credentials                             |
| `drizzle.auth.migrate.config.ts` | `migrate`                | Auth config plus the migration URL                                                     |
| `drizzle.migrate.config.ts`      | `migrate`                | Shared config plus the migration URL                                                   |
| `drizzle.api.config.ts`          | `studio:api`             | Shared config plus API credentials; shows `auth`, `app`, and `pgboss`                  |
| `drizzle.worker.config.ts`       | `studio:worker`          | Shared config plus worker credentials; shows `app` and `pgboss`                        |

The API and worker configs are inspection tools. Running apps use `clients.ts`,
not these files. Studio schema filters control what Studio displays; PostgreSQL
grants enforce access. Studio runs with its selected account's write permissions,
so changes through Studio can affect the database.

## Commands

| Repository-root command       | Action                                                               |
| ----------------------------- | -------------------------------------------------------------------- |
| `pnpm database generate`      | Generate migration SQL and snapshots from Drizzle definitions        |
| `pnpm database generate:auth` | Generate auth migration SQL and snapshots                            |
| `pnpm database migrate`       | Apply pending migrations as the migrator                             |
| `pnpm database check`         | Check migration history consistency; does not verify a live database |
| `pnpm database studio:api`    | Start Studio with API credentials                                    |
| `pnpm database studio:worker` | Start Studio with worker credentials                                 |
| `pnpm database build`         | Build the package and TypeScript declarations                        |
| `pnpm database typecheck`     | Check package types                                                  |
| `pnpm database test`          | Run environment tests and configured database integration tests      |
| `pnpm database test:watch`    | Run tests in watch mode                                              |
| `pnpm database test:verbose`  | Run tests with verbose reporting                                     |

Migration deployment requires this package's SQL files, configuration, and
Drizzle Kit dependencies. The build emits the application connection API; it
does not create a standalone migration executable.

## Errors and troubleshooting

| Symptom                                    | Meaning and next step                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Environment validation fails during import | Check the named setting, the URL required by the selected connection or tool, and whether the environment was loaded before import |
| `DATABASE_CONFIG_INVALID`                  | Production URL policy rejected the named variable; check hostname and sslmode                                                      |
| `DATABASE_STARTUP_FAILED`                  | Connection or role validation failed; check authentication, account name, foundation migration, and role privileges                |
| `DATABASE_POOL_ERROR`                      | An idle connection failed; inspect PostgreSQL availability and network health                                                      |
| Startup fails before the first migration   | Provision the roles and apply migrations so the required schemas exist                                                             |
| Worker cannot read `auth` tables           | Expected permission boundary; authentication operations belong to the API                                                          |
| Shutdown waits indefinitely                | Check for clients that were checked out but never released                                                                         |

Connection startup failures are deliberately redacted and do not include the
original connection error. `DATABASE_ROLE_INVALID` is an internal check failure
wrapped as `DATABASE_STARTUP_FAILED`. Ordinary environment schema failures come
from `@xcvzlabs/env`; they do not all use the production URL error code.
Query errors after startup are returned by Drizzle or node-postgres to the caller.

## Verification

Database environment tests run with `pnpm database test` without PostgreSQL.
Persistence integration tests live in `packages/database/tests/` and require a disposable
PostgreSQL 18 cluster with local trust authentication and an administrator named
`postgres`:

```sh
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres pnpm database test
```

Use the port of your disposable cluster. The suite creates a temporary database
and the fixed deployment roles, and removes them afterward. Do not use a shared
or production cluster, or one that already contains those roles. Without
`TEST_DATABASE_URL`, integration tests are skipped.

The tests cover environment parsing and production URL policy, clean and repeated
migration application, failed migration rollback, role grants and denied DDL,
pool settings and shutdown, role identity checks, and query logging.

Run `pnpm check` from the repository root for lint, formatting, and workspace type
checks. A passing static check does not replace migration and permission tests
against PostgreSQL.

## File responsibilities

| Path                 | Owns                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| `src/index.ts`       | Public application exports                                                |
| `src/clients.ts`     | Pools, Drizzle clients, runtime identity checks, and shutdown             |
| `src/env.ts`         | Validated runtime environment                                             |
| `src/env-schema.ts`  | Shared environment validators and production URL policy                   |
| `src/auth/`          | Auth schemas, relations, clients, enrollment queries, and MFA persistence |
| `src/queue.ts`       | pg-boss startup and transaction integration                               |
| `src/schema.ts`      | Foundation/application schema declarations                                |
| `drizzle*.config.ts` | CLI configuration                                                         |
| `provision.sql`      | Administrator role provisioning                                           |
| `migrations/`        | Reviewed migration SQL and snapshots                                      |
| `tests/`             | Environment and PostgreSQL integration tests                              |

## Auth persistence boundary

`@pipong/database` owns auth tables, relations, typed clients, SQL operations,
migrations, and queue database infrastructure. `@pipong/database/auth` exposes
concrete enrollment and MFA persistence functions. Table metadata is exported for
the Better Auth adapter and schema generator; auth policy uses persistence functions.

`@pipong/auth` owns Better Auth configuration and adapter wiring, enrollment/MFA
policy, and auth email delivery. Its schema-generator config reflects its plugins
and writes an ignored reference schema; reviewed schema definitions stay here.

Run `pnpm migrate` at the repository root to apply `migrations/foundation/` before
`migrations/auth/`, then `migrations/tenancy/`. The existing directories retain their SQL and snapshot IDs
and use the existing shared PostgreSQL history. Use `pnpm database generate:auth`
for auth schema changes.

See [human authentication](../../AUTHENTICATION.md) for auth persistence and mail.

## Tenant transaction boundary

`@pipong/database/tenancy` exports `withTenantTransaction`, `TenantScope`, and
`TenantTransaction`. Table definitions remain internal to database. Later
capabilities add concrete repository operations here rather than exporting tables.

Call the gateway with a scope established by application authorization. The
`kind` selects organization, project, or environment scope; narrower scopes require
all parent IDs. Valibot rejects malformed IDs, missing parents, and extra fields
with `TENANT_SCOPE_INVALID` before acquiring a connection.

The gateway begins a Drizzle transaction and sets all three scope values using
parameterized, transaction-local `set_config`. Organization scope includes its
projects and environments. Project scope includes only its project and its
environments. Environment scope includes only its environment and parent project.
Missing organization context returns no rows and rejects inserts. Policies check
both existing rows and new values; composite references prevent an environment
from claiming a project in another organization. Ownership references restrict
deletion until dependent records are removed.

Await all callback work before returning. The callback commits on success and
rolls back on rejection. Context expires at either outcome, including when the
same pooled connection is reused. Start each tenant unit of work through this
gateway; savepoints within the callback retain that transaction's scope. Do not
open another tenant gateway inside its callback or issue session-level scope SETs.

The gateway validates scope shape, not membership, grants, revocation, or MFA.
Those decisions belong to `@pipong/service`. Public capabilities use its
`withAuthorizedTransaction` boundary, which reads live authority through
`@pipong/database/authorization` before calling `setTenantScope` in the same transaction.
Runtime SQL can choose its own context, so
RLS protects against omitted predicates and does not replace authorization or
parameterized queries. PostgreSQL constraint errors remain internal; future HTTP
adapters must map them without exposing another tenant's identifiers.

Authorization persistence includes organization disablement and
`auth.service_key_grants`, with composite references to the key's organization
and the complete environment scope. Grants are authority records read before
tenant context, alongside human membership. Their migration belongs to the tenancy
directory because it depends on the application environment tables. Worker
credentials have no access to these auth records. See
[domain authorization](../../AUTHORIZATION.md) for permissions and lock ordering.

Generate tenant schema changes with `pnpm database generate:tenancy`. Review the
SQL and preserve explicit `FORCE ROW LEVEL SECURITY` statements, which Drizzle's
schema generator does not represent. `pnpm database migrate` applies all three
migration directories in dependency order. Deployments must serialize migrations.

The PostgreSQL suite verifies missing and invalid context, scope-limited reads
and mutations, composite ownership, FORCE RLS flags, rollback, concurrent
transactions, and context reset using a one-connection pool for each runtime role.

## Provider delivery queues

The tenancy migration provisions `delivery-apns`, `delivery-fcm`, and
`delivery-web-push` in the existing `pgboss` schema. Run `pnpm migrate` with
migration credentials before deploying the worker. Runtime accounts can use
queue tables but cannot create queues, run migrations, or execute queue DDL
functions.

`startDeliveryQueue(database, 'producer')` starts without supervision;
`startDeliveryQueue(database, 'worker')` enables infrastructure recovery and
checks that all provider queues exist. Neither call creates storage or registers
provider consumers. Stop the queue before closing its database pool. The worker
uses one queue runtime for authentication mail and provider queue supervision.

`@pipong/service` exports `enqueueDelivery`. Pass the authorized application
transaction, a fresh UUIDv7 queue job ID, and tenant/notification/delivery IDs
with the provider. The strict job schema rejects extra fields. Queue jobs hold
identifiers only; workers must load and authorize application state before a
send. A suppressed insertion throws `DELIVERY_ENQUEUE_FAILED`, so callers must
let the transaction roll back rather than accept the request.

Database uses the pinned pg-boss Drizzle adapter for insertion and completion.
Insertion sets `keep_until` to PostgreSQL infinity in the same transaction because
pg-boss otherwise deletes queued/retry jobs when their retention expires.
`completeDeliveryJob` receives the fetched claim's ID and retry count and
requires exactly one affected job. `DELIVERY_QUEUE_CLAIM_LOST` rolls back the
result transaction when that claim is stale or no longer active.

Provider queues use a 120-second execution lease, a 30-second heartbeat, and five
infrastructure recovery retries with exponential backoff from 5 seconds capped
at 300 seconds. Provider outcome retries belong to application policy, not these
recovery retries. No provider consumers are enabled yet. Provider requests must
finish within the heartbeat/lease budget once consumers are implemented.

Automatic deletion is disabled for finished provider jobs, including exhausted
failures. Unfinished jobs and failed evidence remain until application retention
and reconciliation are implemented. Operators should monitor queue storage;
this increment does not provide notification submission or delivery status APIs.
The PostgreSQL lifecycle suite exercises transactional insertion/completion,
suppression, stale claims, crash recovery, retention, and provisioning denial.
