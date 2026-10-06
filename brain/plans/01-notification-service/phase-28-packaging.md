# Self-hosted installation

Back to [[plans/01-notification-service/overview]]

## Goal

Produce non-root apps/server and apps/worker artifacts, Compose stack and one-shot migration/bootstrap workflow with secret injection and TLS/SSE proxy documentation. Build Nitro from apps/server, package its .output, and set commands/working directories explicitly. Include operator commands in shipped artifacts.

## Changes

- Dockerfile
- compose.yaml
- README.md

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
