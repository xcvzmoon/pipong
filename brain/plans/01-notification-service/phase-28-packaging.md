# Self-hosted installation

Back to [[plans/01-notification-service/overview]]

## Goal

Produce non-root apps/server and apps/worker artifacts, Compose stack and one-shot migration/bootstrap workflow with secret injection and TLS/SSE proxy documentation. Build Nitro from apps/server, package its .output, and set commands/working directories explicitly. Include operator commands in shipped artifacts.

## Implementation evidence

- Implemented locally, 2026-10-10. Docker targets package the complete Nitro output, worker/operator chunks, the locked Drizzle migration toolchain, and PostgreSQL initialization scripts. API, worker, operator, and migration jobs run as UID 1000.
- Compose isolates API, worker, and migration dotenv secrets; runtime apps receive no migration or administrator credentials. PostgreSQL uses an operator-provided TLS certificate. API and worker have read-only roots, dropped capabilities, and explicit shutdown grace periods. The API liveness probe reads the mounted diagnostics token.
- Clean PostgreSQL 18.6 installation, all three migration sets, operator bootstrap, and repeat migrations passed from images without checkout mounts. Built API verification covered login, project/environment creation, credential activation, endpoint registration, submission, status, event replay, and SSE. Disposable administrator fixtures supplied verified-email/MFA state; SMTP and provider credentials were protocol inputs, not live-provider qualification.
- Certificate-verified nginx HTTPS delivered authenticated SSE without buffering. Runtime database connections reported TLS. Missing secrets and administrator runtime credentials failed startup. Restricted role flags, worker SIGTERM cleanup, and durable notification state after restart passed.
- `pnpm install`, `pnpm check`, workspace build, Compose configuration validation, and shell syntax checks passed. Workspace tests passed 103 cases; 134 database-dependent cases skipped without their integration settings. Installation verification used its own disposable real PostgreSQL stack.
- Operator instructions are in `INSTALLATION.md`. The single-replica stack uses a maintenance window; rolling replacement requires proxy rotation and a compatible schema release. Live SMTP/device qualification, load, and restore evidence remain release gates. Provider consumers remain disabled and full readiness remains 503. Next is phase 29 CI.
- Release tagging uses genbumppush's multi-image support with `{{version}}` source references and `{{version}}`/`{{tag}}` destination tags for all four GHCR images. `pnpm release:build` builds the previewed version; Compose selects every image through `PIPONG_VERSION`. A preview-only dry run confirmed `0.0.6` and `v0.0.6`; the real release retains its clean-worktree guard. No release was published.
- Full follow-up verification, 2026-10-10: all 237 tests across 30 files passed without skips against disposable PostgreSQL 18.6 UTF-8. All four test database URL variables pointed at the isolated cluster; `pnpm --recursive --workspace-concurrency=1 --if-present run test --no-file-parallelism` serialized shared-role fixtures. Check and migration-history checks passed. After user-authorized deletion of all previous Docker containers, volumes, images, and cache, all four images rebuilt at the current package version `0.0.5`. The test container and regenerated build cache were removed afterward.

## Changes

- Dockerfile
- compose.yaml
- README.md
- Supporting files: `.dockerignore`, `INSTALLATION.md`, and `ops/` scripts for TLS key ownership, database provisioning, and sequential migration execution.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- DeploymentTopology

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Install from built artifacts in a clean environment with no checkout-mounted sources; bootstrap, register endpoints, submit, observe, drain and restart.
- Behavioral scenarios: Clean install; restricted runtime role; secret injection; SSE proxy; rolling drain.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
