# Human authentication

Back to [[plans/01-notification-service/overview]]

## Goal

Configure Better Auth organization, API-key, TOTP, database session/rate-limit storage, and transactional Drizzle adapter; generate exact schema. Mount its Web handler without dropping cookies or consuming request bodies.

## Changes

- packages/service/src/auth.ts
- apps/server/src/api/auth/[...all].ts
- tests/auth.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- AuthSession, OrganizationMembership

## Routing

- Execution: codex/gpt-5.4 per the plan skill's routing guide, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Complete HTTP login/logout/TOTP challenge and verify all Set-Cookie headers via the built Nitro server. Disable public signup/org creation, unwanted admin operations, raw key mutation, and bypassing organization deletion.
- Behavioral scenarios: Cookie propagation; signup denial; MFA challenge; session revocation; raw endpoint bypass denial.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
