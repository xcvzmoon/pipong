# Organization service keys

Back to [[plans/01-notification-service/overview]]

## Goal

Issue once-visible organization keys through @better-auth/api-key with immutable relational environment grants, expiry, rotation, and revocation. Unbound keys are unusable, and creator departure does not revoke organization integrations.

## Changes

- packages/service/src/service-keys.ts
- packages/service/src/schema/service-keys.ts
- tests/service-keys.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- ServiceKeyBinding, EnvironmentGrant

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Create a key via an MFA-authorized operator session, call a scoped resource, rotate with deliberate overlap, then observe old-key denial across replicas.
- Behavioral scenarios: Grant escalation; orphan creation; expiry units; rotation/revocation; creator departure.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
