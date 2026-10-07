# Organization service keys

Back to [[plans/01-notification-service/overview]]

## Status

- Implemented and independently reviewed, 2026-10-07. Next: [[plans/01-notification-service/phase-11-recipients]].
- Verified `pnpm check`, `pnpm database check`, `pnpm build`, and the full `pnpm test` suite with PostgreSQL 18. All 72 tests ran and passed against disposable databases.
- Built HTTP coverage includes all four operations, generated OpenAPI schemas, expiry units, immutable grants, role/MFA and scope denial, concurrent rotation, issuance rollback, and two-process overlap/revocation.
- Public contract: `SERVICE_KEYS.md`. Database owns repositories, the scope index, rotation state, audit persistence, and privileges. Auth owns transactional Better Auth issuance and key metadata retention; service owns lifecycle policy.
- Secrets appear only at issuance/rotation. Grants and key identity are immutable under runtime privileges; audits are append-only. Metadata remains until the phase-26 retention/erasure capability.
- This phase does not certify provider delivery or the remaining production release gates.

## Goal

Issue once-visible organization keys through @better-auth/api-key with immutable relational environment grants, expiry, rotation, and revocation. Unbound keys are unusable, and creator departure does not revoke organization integrations.

## Changes

- `packages/database/src/service-keys/index.ts`, `packages/database/src/authorization/schema.ts`, and the tenancy migration own persistence.
- `packages/auth/src/service-keys.ts` issues keys through Better Auth in the authorized transaction.
- `packages/service/src/service-keys.ts` owns validation and lifecycle policy.
- Four concrete Nitro handlers under the environment service-key collection own the HTTP/OpenAPI contract.
- Runtime evidence is in `apps/server/tests/service-keys.integration.test.ts`.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- ServiceKeyBinding, EnvironmentGrant

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Create a key via an MFA-authorized operator session, call a scoped resource, rotate with deliberate overlap, then observe old-key denial across replicas.
- Behavioral scenarios: Grant escalation; orphan creation; expiry units; rotation/revocation; creator departure.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
