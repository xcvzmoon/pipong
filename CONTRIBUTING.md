# Contributing to Pipong

Thanks for taking the time to contribute. This document covers development setup, coding standards, and the pull request process.

By participating in this project, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to Contribute

- **Bug reports**: open an [issue](https://github.com/xcvzmoon/pipong/issues/new/choose) using the bug report template.
- **Feature requests**: use the feature request template, or start a [discussion](https://github.com/xcvzmoon/pipong/discussions) to explore an idea.
- **Security vulnerabilities**: do not open a public issue. Follow [SECURITY.md](./SECURITY.md) instead.
- **Code and documentation**: pull requests are welcome. For larger changes, open an issue first to agree on direction.

## Development Setup

Pipong is a notification API service built with Nitro v3, h3, and Rolldown. Development and CI use the `devEngines` declarations in `package.json`: Node.js `^24.0.0` and pnpm 12.6.0. `pnpm install` downloads the configured Node.js runtime when needed, and the shared CI setup action reads these declarations without a separate runtime override.

```bash
pnpm install
pnpm dev
```

See the [README](./README.md) for build and preview commands. Nitro routes live in `apps/server/src/routes/`, API-prefixed handlers belong in `apps/server/src/api/`, and static assets live in `apps/server/public/`. Run server package scripts from root with `pnpm server <script> [args...]`. Dependencies are managed through the named catalogs in `pnpm-workspace.yaml`, with resolved versions in `pnpm-lock.yaml`. Commit lockfile changes when changing dependencies.

Use `pnpm build`, `pnpm typecheck`, and `pnpm dev` for all workspace packages with that script. Development scripts run in parallel; packages without the script are skipped. Use `pnpm server <script>` when only the server should run.

## Coding Standards

Project conventions live in [AGENTS.md](./AGENTS.md):

- Use TypeScript and explicit `.ts` extensions in imports.
- The server's `~/*` path alias currently resolves from `apps/server/`, not the repository root.
- Follow Nitro's server directory conventions for routes, middleware, plugins, and utilities.
- Refer to `apps/server/node_modules/nitro/dist/docs/README.md` when working on server code; this project uses Nitro v3.
- Make the smallest correct change. Avoid unrelated refactors and speculative abstractions.

Formatting, linting, and type checking are automated:

```bash
pnpm check        # uncheck: formatting, linting, and type checking
pnpm check --fix  # apply supported formatting and lint fixes
pnpm fmt          # format files
pnpm lint         # lint code
```

Root TypeScript checks cover repository tooling configs. uncheck discovers each workspace's `tsconfig.json` separately, so server code is checked with Nitro's compiler settings.

The `prepare` script installs an uncheck pre-commit hook. It checks staged files and applies supported fixes before a commit.

The vendored anti-slop plugin lives in `tools/oxlint/anti-slop/`; its source revision and local changes are recorded in [UPSTREAM.md](./tools/oxlint/anti-slop/UPSTREAM.md). All generic rules are enabled as errors in `oxlint.config.ts`. Keep the `oxlint` and `@oxlint/plugins` catalog versions pinned together when upgrading.

Agent tooling and the vendored plugin are excluded from linting and formatting. Maintain those ignores in both `oxlint.config.ts` and `oxfmt.config.ts`; application source remains checked.

## Verification

```bash
pnpm check
pnpm test
pnpm build
pnpm server preview
```

Exercise the affected endpoint or behavior against the running service and describe the request, expected result, and observed result in your pull request. The current starter handler is `GET /`; for example, `curl http://localhost:3000/` checks its response.

`pnpm test` runs Vitest; empty server test selection fails. Database integration suites require disposable PostgreSQL fixtures. Run `CI_DATABASE_URL=postgres://postgres@127.0.0.1:55439/postgres sh ops/check-ci.sh` to set every fixture URL and run checks, migration-history validation, builds, and sequential tests. See the [integration gates](README.md#integration-and-release-gates) for image verification and fixture requirements.

CI runs database, service, and server tests in parallel jobs, each with its own disposable PostgreSQL service. Test files within each job remain sequential because their fixtures create and remove fixed deployment roles. A separate job runs formatting, linting, type checks, migration-history checks, the workspace build, auth tests, and all four versioned image installation checks. The final `CI` job requires every job to succeed. Release tags still run the shared sequential integration gate before image verification and publishing.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/), especially for pull request titles:

```text
feat: add notification endpoint
fix: handle invalid notification requests
chore(ci): bump action versions
docs: update deployment guide
```

## Pull Request Process

1. Fork the repository or create a branch if you have write access.
2. Run `pnpm check`, `pnpm test`, and `pnpm build`, then exercise the changed behavior locally.
3. Open a pull request against `main`, using the template to describe the change, related issues, and verification.
4. The `CI` job must pass all validation steps.
5. A maintainer reviews and merges the approved change.

## Releases

Maintainers run `pnpm release` to generate a changelog, bump the version, create a tag, and push the changes through genbumppush. This command changes repository state and requires Git push access; it is not a verification command. Local Docker images are not required. The pushed tag starts the release workflow, which publishes verified images and creates the GitHub release using `ops/genbumppush.config.ts`.

The release workflow runs on `v*` tags. It verifies that the tag matches `package.json`, runs the same integration and image installation gates as CI, publishes the verified images to GHCR, then creates or synchronizes the GitHub release using `GITHUB_TOKEN`. Pipong is a private package and is not published to npm.

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE.md).
