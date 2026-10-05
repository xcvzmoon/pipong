# Workspace boundaries

Back to [[plans/01-notification-service/overview]]

## Goal

Declare apps/server, apps/worker, and packages/service as a thin workspace. Root is tooling/orchestration, not the Nitro app. Complete the bounded relocation packets in [[plans/01-notification-service/workspace-relocation]] before phase 02; dependencies belong to their app/shared package.

## Changes

- pnpm-workspace.yaml
- package.json
- packages/service/package.json

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- Workspace package exports

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Install the workspace, resolve shared imports from each app context, and launch the relocated Nitro starter from apps/server. Root commands delegate to the selected app or aggregate workspace checks/builds without recursion.
- Behavioral scenarios: Workspace install; app-local dependency resolution; relocated API response; root command delegation; no provider dependencies in request-only imports.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
