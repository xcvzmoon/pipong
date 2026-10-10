# Pipong

API service for notifications, built with [Nitro v3](https://nitro.build), [h3](https://h3.dev), and [Rolldown](https://rolldown.rs).

## Implementation plan

The notification service design, scope, implementation phases, and release gates are in [the implementation plan](./brain/plans/01-notification-service/overview.md).

Web Push destination checks and operator exceptions are documented in [Web Push egress](./EGRESS.md).

## Getting started

Use Node.js 24.x and pnpm 12.6.0, declared in `package.json`. `pnpm install` downloads the configured Node.js runtime when needed; CI reads the same `devEngines` declarations.

```bash
pnpm install
pnpm dev
```

The Nitro application lives in `apps/server`, with routes and middleware under `apps/server/src`. Root scripts own shared tooling.

Root workspace commands run each package that defines the corresponding script:

```bash
pnpm build
pnpm typecheck
pnpm dev
pnpm test
pnpm test:verbose
pnpm test:watch
```

Builds, typechecks, and test runs execute in dependency order. Development and test-watch scripts run in parallel so long-running processes can start together. Packages without a matching script are skipped, and failures are reported. The root package is excluded from recursive execution to avoid calling these dispatchers again. `pnpm typecheck` checks workspace packages; `pnpm check` also checks root tooling and runs lint/format validation.

Run any server package script from the repository root with `pnpm server <script> [args...]`:

```bash
pnpm server build
pnpm server dev --port 3100
pnpm server preview --port 3100
```

Arguments after the script name are forwarded to that script. An unknown script fails rather than falling back to an executable.

The independent Node.js worker lives in `apps/worker`. It processes queued authentication email, reconciles exhausted delivery jobs, runs bounded erasure and retention, and supervises the migrated APNs, FCM, and Web Push queues. Push delivery consumers are not enabled yet. See the internal [APNs](./APNS.md), [FCM](./FCM.md), and [Web Push](./WEB-PUSH.md) adapter notes. Run migrations before deploying the worker; see [provider queue operations](./packages/database/README.md#provider-delivery-queues).

```bash
pnpm --filter pipong-worker build
pnpm --filter pipong-worker start
```

The built entrypoint is `apps/worker/dist/index.mjs`. Deploy the whole `dist` directory, which includes shared chunks. It runs without the source checkout or runtime dependencies and closes its database pool on SIGINT or SIGTERM. Provision PostgreSQL and run the database package’s Drizzle migration command as described in [runtime configuration](./CONFIGURATION.md) before starting either app.

## Authentication

[Human authentication](./AUTHENTICATION.md) describes the native auth routes, TOTP, session revocation, and queued SMTP email. Use the local operator command for bootstrap and account provisioning, then the native invitation and MFA flows for enrollment.

[Domain authorization](./AUTHORIZATION.md) describes role permissions, environment-bound service keys, recent MFA, and the transaction boundary used by `/api/v1` capabilities.

[Projects and environments](./PROJECTS.md) describes scoped resource operations,
pagination, suspension, and erasure requests.

[Organization service keys](./SERVICE_KEYS.md) describes once-visible issuance,
fixed environment grants, rotation overlap, revocation, and metadata retention.

[Application recipients](./RECIPIENTS.md) describes environment-scoped identities,
upsert/read/list operations, pagination, and erasure requests.

[Provider credentials](./CREDENTIALS.md) describes encrypted immutable versions,
activation, retirement, VAPID public keys, and encryption-key rotation.

[Recipient endpoints](./ENDPOINTS.md) describes encrypted installation registration,
generation checks, provider binding, and redacted metadata.

[Notification contracts](./NOTIFICATIONS.md) describes validated requests, provider
payload limits, atomic submission, and seven-day idempotent replay.

[Delivery recovery](./RECOVERY.md) describes retry bounds, pending cancellation,
audited redrive, and exhausted-job reconciliation.

[Erasure and retention](./ERASURE.md) describes lifecycle tombstones, the reserved-send
exception, bounded cleanup, audit retention, and backup exclusions.

[Notification status](./OBSERVATION.md) describes summary counts, delivery
outcomes, redacted attempts, and pagination.

[Delivery events](./EVENTS.md) describes ordered replay, SSE streams, scoped
cursors, connection limits, and retention watermarks.

[APNs delivery](./APNS.md) describes the internal HTTP/2 adapter, credential
binding, receipt settlement, and outstanding device qualification.

## Deploying

Use the [self-hosted installation guide](./INSTALLATION.md) for Docker artifacts,
PostgreSQL TLS, isolated secrets, one-shot migrations, operator bootstrap, and
SSE reverse-proxy configuration.

The tag-triggered release workflow builds, verifies, and publishes Docker images
with matching version and Git release tags. See
[release image tags](./INSTALLATION.md#release-image-tags) for release commands.

See [runtime configuration](./CONFIGURATION.md) for required secrets, pool budgets, auth URL rules, and worker provider settings.

```bash
pnpm run check
pnpm build
pnpm server preview
```

See the [Nitro deployment documentation](https://nitro.build/deploy) for deployment presets.

## Contributing

Read the [contribution guidelines](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in the [security policy](./SECURITY.md).

## License

[MIT](./LICENSE.md)

See [OBSERVABILITY.md](OBSERVABILITY.md) for protected health/metrics, redacted
telemetry, privileged audits, and alert setup.

## Integration and release gates

CI and tagged releases cover the same gates after installing the frozen lockfile.
Run them locally with:

```sh
CI_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres sh ops/check-ci.sh
PIPONG_VERSION=ci-local pnpm release:build
PIPONG_VERSION=ci-local sh ops/check-images.sh
```

The database URL must point to a disposable PostgreSQL 18 cluster with trust
authentication and an administrator named `postgres`. Tests create and remove
fixed deployment roles. The gate sets all four integration fixture URLs and runs
packages and test files sequentially, so suites cannot race over those roles.
CI runs database, service, and server tests in parallel jobs with separate
PostgreSQL services; test files within each job remain sequential. Static checks,
auth tests, and image verification run in a separate job. The final `CI` job
requires all jobs to pass. Tagged releases use the sequential gate shown above.
The gate checks formatting, lint, types, migration history, both deployable builds,
and the real PostgreSQL/protocol/HTTP suites. An empty server test run fails.
The schema tests cover clean installation and upgrading an earlier tenant schema
while preserving existing data.

Image verification needs Docker Compose v2 with `!override` support, OpenSSL,
and curl. It installs all four versioned images into an isolated temporary TLS
stack, repeats migrations, checks non-root application images and operator
bootstrap, probes API liveness, and verifies worker lease creation and removal
on shutdown. It removes containers, volumes, and temporary secrets on exit.
No provider traffic is sent by this smoke test.

Tagged releases verify the package version, pass these gates, publish the four
verified images to GHCR, then create or sync the GitHub release. Registry writes
use the workflow token with package write permission. Live provider, load, and
restore qualification remains part of phase 30.

The tested runtime matrix is Node 24, pnpm 12.6.0, PostgreSQL 18, and Debian
Bookworm images. Dependency versions come from the committed lockfile; CI uses
that lockfile rather than resolving new versions. Production qualification and
framework pinning remain release gates.

Release qualification is tracked in [release evidence](docs/release-evidence.md).
Recovery and incident procedures are in [operations](docs/operations.md).
