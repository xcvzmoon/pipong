# Domain permission decisions

Back to [[plans/01-notification-service/overview]]

## Status

- Complete, 2026-10-07. Domain checks and operations share a transaction; live authority and scoped resources stay locked until it finishes. Management acquires update locks without upgrading shared resource locks.
- Human roles are owner/admin/member, with operational reads for members and organization management reserved for owners. Privileged management and redrive require current-session MFA within five minutes.
- Organization-owned keys require an exact environment grant and explicit supported actions. Composite references bind both the key's organization and the environment ownership chain. Native key mutations remain blocked; issuance is phase 10.
- The built HTTP fixture proves the role matrix, stale/forged context, removal/demotion, recent MFA, organization disablement, nested/sibling scope, key expiry/revocation/throttling, mixed credentials, and origin checks. Membership removal and grant deletion wait for authorized transactions; later requests are denied.
- Validation: pnpm check, workspace build, all 26 server tests and 7 auth tests with TEST_AUTH_DATABASE_URL, all 29 database tests with TEST_DATABASE_URL, migration snapshot checks, and auth schema generation. PostgreSQL suites ran separately on a disposable PostgreSQL 18 cluster.
- Operator/developer contract: AUTHORIZATION.md. The diagnostic fixture route is absent from the production server build. No new public resource operations are part of this phase.

## Goal

Resolve human membership or organization key authority to explicit resource scope and action; active organization cannot grant authority. Enforce live disable/revocation and recent MFA on privileged actions.

## Changes

- packages/service/src/authorize.ts
- apps/server/src/middleware/authentication.ts
- apps/server/tests/authorization.integration.test.ts

- Database-owned supporting changes: authorization queries and grant schema in packages/database/src/authorization, organization disablement and key ownership constraints, and generated auth/tenancy migrations. The shared tenancy gateway now exposes transaction-local context setup for the authorized transaction.

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
