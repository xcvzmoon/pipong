# Domain permission decisions

Back to [[plans/01-notification-service/overview]]

## Goal

Resolve human membership or organization key authority to explicit resource scope and action; active organization cannot grant authority. Enforce live disable/revocation and recent MFA on privileged actions.

## Changes

- packages/service/src/authorize.ts
- apps/server/src/middleware/authentication.ts
- tests/authorization.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- Principal, DomainAction

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Invoke the built API with session/key/both credentials and two organizations; stale and forged context never authorizes.
- Behavioral scenarios: Role matrix; active-org switch; removal/demotion; cookie+key ambiguity; sibling environment denial.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
