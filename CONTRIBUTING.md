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
pnpm run dev
```

See the [README](./README.md) for build and preview commands. API handlers live in `server/api/`; static assets live in `public/`. Dependencies are managed through the catalog in `pnpm-workspace.yaml`, with resolved versions in `pnpm-lock.yaml`. Commit lockfile changes when changing dependencies.

## Coding Standards

Project conventions live in [AGENTS.md](./AGENTS.md):

- Use TypeScript and explicit `.ts` extensions in imports.
- Use the `~/*` path alias for imports from the project root when appropriate.
- Follow Nitro's server directory conventions for routes, middleware, plugins, and utilities.
- Refer to `node_modules/nitro/dist/docs/README.md` when working on server code; this project uses Nitro v3.
- Make the smallest correct change. Avoid unrelated refactors and speculative abstractions.

Formatting, linting, and type checking are automated:

```bash
pnpm run check        # uncheck: formatting, linting, and type checking
pnpm run check --fix  # apply supported formatting and lint fixes
pnpm run fmt          # format files
pnpm run lint         # lint code
```

The `prepare` script installs an uncheck pre-commit hook. It checks staged files and applies supported fixes before a commit.

The vendored anti-slop plugin lives in `tools/oxlint/anti-slop/`; its source revision and local changes are recorded in [UPSTREAM.md](./tools/oxlint/anti-slop/UPSTREAM.md). All generic rules are enabled as errors in `oxlint.config.ts`. Keep the `oxlint` and `@oxlint/plugins` catalog versions pinned together when upgrading.

Agent tooling and the vendored plugin are excluded from linting and formatting. Maintain those ignores in both `oxlint.config.ts` and `oxfmt.config.ts`; application source remains checked.

## Verification

```bash
pnpm run check
pnpm run build
pnpm run preview
```

Exercise the affected endpoint or behavior against the running service and describe the request, expected result, and observed result in your pull request. For example, `curl http://localhost:3000/api` checks the starter API response.

There is currently no automated test script. Do not claim a test suite passed; include concrete verification evidence, and add regression coverage where appropriate for behavior changes.

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
2. Run `pnpm run check` and `pnpm run build`, then exercise the changed behavior locally.
3. Open a pull request against `main`, using the template to describe the change, related issues, and verification.
4. CI must pass its check and build jobs.
5. A maintainer reviews and merges the approved change.

## Releases

Maintainers run `pnpm run release` to generate a changelog, bump the version, create a tag, push the changes, and create a GitHub release through genbumppush. This command changes repository state and requires push access and GitHub authentication; it is not a verification command.

The release workflow runs on `v*` tags. It verifies that the tag matches `package.json`, runs checks and a build, then creates or synchronizes the GitHub release using `GITHUB_TOKEN`. Pipong is a private package and is not published to npm.

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE.md).
