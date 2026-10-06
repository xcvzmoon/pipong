# Pipong

API service for notifications, built with [Nitro v3](https://nitro.build), [h3](https://h3.dev), and [Rolldown](https://rolldown.rs).

## Implementation plan

The notification service design, scope, implementation phases, and release gates are in [the implementation plan](./brain/plans/01-notification-service/overview.md).

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

The independent Node.js worker lives in `apps/worker`. It opens its database pool and waits for shutdown; delivery consumers are not enabled yet.

```bash
pnpm --filter pipong-worker build
pnpm --filter pipong-worker start
```

The built entrypoint is `apps/worker/dist/index.mjs`. Deploy the whole `dist` directory, which includes shared chunks. It runs without the source checkout or runtime dependencies and closes its database pool on SIGINT or SIGTERM. Provision PostgreSQL and run the database package’s Drizzle migration command as described in [runtime configuration](./CONFIGURATION.md) before starting either app.

## Deploying

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
