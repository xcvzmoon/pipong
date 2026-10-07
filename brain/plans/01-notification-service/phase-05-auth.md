# Human authentication

Back to [[plans/01-notification-service/overview]]

## Status

- Completed 2026-10-06. Better Auth 1.7.7, its matching plugins/adapter, Unemail 0.7.0, Handlebars 4.7.8, and pg-boss 12.37.0. Changes remain uncommitted per repository instructions.
- Next: [[plans/01-notification-service/phase-06-enrollment]].

## Goal

Configure Better Auth organization, API-key, TOTP, database session/rate-limit storage, and transactional Drizzle adapter; generate exact schema. Mount its Web handler without dropping cookies or consuming request bodies.

- Wire authentication mail callbacks to durable pg-boss jobs for Unemail delivery with Handlebars templates. Introduce the mail queue and worker alongside these callbacks, before enabling flows that need email. Verification, recovery, and invitation flows are completed in phase 06.
- Database schemas and migrations belong in `packages/database`, following [[plans/01-notification-service/database-ownership]].

## Implementation packets

- Auth persistence: `packages/database/src/auth/` owns schemas, relations, typed clients, and SQL operations; generated SQL stays in `packages/database/migrations/auth/`. Auth owns `tooling/auth.config.ts` and the Better Auth adapter, using Drizzle Relations v2.
- Auth HTTP: `packages/auth/src/auth.ts`, `apps/server/src/api/auth/[...all].ts`, and `apps/server/tests/auth.integration.test.ts`. Nitro startup owns resource initialization and cleanup.
- Mail persistence: `packages/database/src/queue.ts`, `packages/database/tooling/generate-mail-queue.ts`, and the custom queue migration. Runtime roles cannot migrate or create queues.
- Mail delivery: `packages/auth/src/mail/`, `apps/worker/src/index.ts`, and `packages/auth/tests/mail.test.ts`; built worker scenarios use the HTTP integration fixture and local SMTP capture.
- Service workspace configuration, lockfile updates, and user/operator documentation accompany these packets. See `AUTHENTICATION.md` for delivered routes and operational limits.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- AuthSession, OrganizationMembership

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Complete HTTP login/logout/TOTP challenge and verify all Set-Cookie headers via the built Nitro server. Disable public signup/org creation, unwanted admin operations, raw key mutation, and bypassing organization deletion.
- Behavioral scenarios: Cookie propagation; signup denial; MFA challenge; session revocation; raw endpoint bypass denial.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.

## Evidence

- `pnpm install`, `pnpm check`, `pnpm build`, and `pnpm database check` passed. Regenerating auth tables followed by Drizzle generation produced no schema changes.
- PostgreSQL 18.6: all 19 database tests passed, including clean/repeated migrations, rollback, grants, pool lifecycle, and denied runtime DDL.
- Built API/worker: all 14 server tests passed, including nine runtime scenarios for cookies/logout, blocked native operations, TOTP, origin/rate-limit enforcement, verification mail and restart, temporary SMTP retries, permanent rejection, invalid/expired mail, and single-use password reset with session revocation. Three mail configuration tests passed.
- Invitations remain blocked until phase 06 supplies enrollment policy. Proxy client addresses share a rate-limit bucket; SMTP delivery can duplicate after a crash. These limits are documented.
