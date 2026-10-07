# Database ownership

Back to [[plans/01-notification-service/overview]]

## Decision

- User direction, 2026-10-06: `packages/database` owns database configuration, connections, Drizzle configuration, schemas, SQL, provisioning, and migrations. Application workspaces receive a connection; they do not read or pass database URLs or pool settings.
- Role-only connection configuration is implemented in `clients.ts`. Database reads API/worker URLs and pool budgets internally; shared app config no longer owns database settings. Schema authoring and future repository integration remain planned.
- Follow [[principles/smallest-complete-design]] and [[principles/prove-boundaries]]: one connection entrypoint, explicit startup/shutdown, and validation at the database boundary.

- API, worker, and migration settings share `env.ts` and `env-schema.ts`. Supplied URLs are validated at import; each connection factory or CLI config requires its own URL. Apps do not require migration credentials.

- File responsibilities: `env.ts` validates environment values only; `clients.ts` constructs pools and manages connections; migration code owns schema execution. Environment code must not import PostgreSQL types or produce pool configuration.

## Connection boundary

- Public contract: `useApiDb()` or `useWorkerDb()`, plus its connection result type. Require the purpose explicitly; do not default silently to API privileges.
- Internally read `API_DATABASE_URL` or `WORKER_DATABASE_URL` and the purpose-specific pool budget from the process environment. Validate with Valibot, map purpose to the exact PostgreSQL role, and apply fixed connection policies.
- Deployment supplies each process its own restricted credentials. Package ownership does not mean API and worker share a login or that credentials are embedded in a build.
- Return the Drizzle connection, pool needed for integrations, and explicit `close()` lifecycle. Apps open once during startup and close during shutdown. No connection is opened merely by importing the package.
- Keep the existing role/grant checks, bounded pools, redacted failures, and failed-startup cleanup. Do not add a URL/options overload or a public test role.
- Tests configure a disposable database through private package fixtures. Testability must not widen the production connection API.

## Schema and migration boundary

- User direction, 2026-10-06: always use UUIDv7 for new record IDs, including Better Auth's runtime ID generator. Schema helpers live at `@pipong/database/helpers`; auth primary keys, references, and audit actor columns use PostgreSQL UUIDs. UUID and update defaults run through Drizzle, not database triggers.

- Database owns schema sources and generated SQL. Its migration command applies foundation migrations before auth persistence migrations.
- Explicit SQL covers privileges and database operations outside the schema generator. Provisioning remains an administrator operation owned by the same package.
- Drizzle generation loads local schema files without requiring live database credentials. Connection-requiring tooling reads credentials internally.
- Migration configuration and SQL paths belong to Drizzle Kit configs. Deployment serializes migration runs. Runtime imports never expose or invoke migrations.
- Remove database-first `pull` and competing public connection factories when implementing this decision. Keep inspection tooling separate from schema ownership.
- User direction, 2026-10-07: Better Auth runtime, adapter, endpoint policy, and auth email handling belong to `packages/auth` (`@pipong/auth`). Database owns auth tables, relations, clients, queries, migrations, and queue database infrastructure. Provider and authorization policy remain outside database.
- Persistence schemas and SQL repositories belong to database. Future service integration must define how repositories are consumed without exporting table internals; a typed connection alone does not provide that repository contract. Do not invent a generic repository framework now.

## Implementation sequence

1. Consolidate connection configuration and pool-budget parsing inside database; replace app calls with the purpose-only entrypoint. Remove database fields from shared app config and relocate their tests.
2. Finish the internal Drizzle generation configuration and single migration workflow. Keep the existing Drizzle Kit migration command.
3. Before each persistence capability, update its plan to place schemas and SQL repositories in database and define only the concrete service access it needs.

## Verification

- Assert that the runtime module exports only the connection factory; app workspaces never read database URL or pool-budget variables.
- Test purpose-specific budgets, missing/invalid settings, production TLS requirements, exact identities, denied privileges, and cleanup against disposable PostgreSQL.
- Prove schema generation needs no live credentials; prove clean/repeated migration and rollback using the database package’s CLI command.
- Run `pnpm check`, applicable tests, and all affected builds. Skipped integration tests do not establish database correctness.

- Review correction, 2026-10-06: pass the central relations to `drizzle()` and retain their type on the runtime client. Auth mail configuration, queue payloads, templates/rendering, SMTP creation, and job processing have separate modules. Use actual `.hbs` templates with an isolated `Handlebars.create()` instance; tsdown and Nitro embed their text, and the worker bundles the auth package. Document only shared public contracts.

- Ownership correction, 2026-10-07: the user confirmed that database operations belong in database. The previous auth-owned persistence split was incorrect. `@pipong/database/auth` exposes the typed client and concrete enrollment/MFA operations; auth consumes them without issuing SQL. Auth table metadata is exported only for Better Auth adapter and schema-generator integration.
- Database preserves foundation and auth migration snapshots in separate folders under `migrations/`, applied in that order against the existing shared history. SQL files and snapshot IDs are unchanged.
- Database owns pg-boss startup and transaction integration. Auth owns email payloads, queue naming, rendering, transport, and delivery policy. Enrollment passes the same transaction to Better Auth and pg-boss so account, organization, audit, and queued email commit together.
- Oxlint prevents auth source/tooling from importing database drivers or Drizzle and prevents database source from importing Better Auth or the auth package.

- Naming correction, 2026-10-07: database tables use plural names (`users`, `verifications`, `api_keys`, `mfa_assurances`). Table declaration identifiers and relation table keys are plural too; Better Auth adapters and schema generation use `usePlural: true`. The generated rename migration replaces the old names without duplicate tables or aliases.
