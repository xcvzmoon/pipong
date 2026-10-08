# Application recipient identities

Back to [[plans/01-notification-service/overview]]

## Status

- Recipient identity operations implemented, 2026-10-08, on `feat/application-recipients`; pending PR integration.
- Database owns the recipient schema, composite environment ownership, repository, migration, forced RLS, and immutable identity privileges. Service owns validation, pagination, and tombstone results. Four concrete Nitro handlers expose upsert/list/read/delete.
- Verified `pnpm check`, `pnpm database check`, `pnpm build`, and all 77 tests with PostgreSQL 18. Five recipient HTTP scenarios validate generated OpenAPI schemas, scoped/repeated/concurrent upserts, input boundaries, nested ownership, cursors, live roles/key grants/revocation, suspension, and delete/upsert races.
- Public contract: `RECIPIENTS.md`. DELETE soft-deletes one identity; subsequent upsert returns `RECIPIENT_DELETED`. Retention/erasure remains phase 26.
- Plan dependency correction: redacted endpoint inspection moves to [[plans/01-notification-service/phase-14-endpoints]], alongside actual endpoint persistence and registration after credentials and egress policy exist. This increment stores no endpoint secrets and publishes no placeholder endpoint route.
- Next: [[plans/01-notification-service/phase-12-credentials]]. This increment does not certify push delivery or production release readiness.

## Goal

Implement project/environment-scoped recipient upsert/list/read/delete. Validate external identity without mapping it to Better Auth users or assuming globally unique emails.

## Changes

- `packages/database/src/recipients/{schema,index}.ts` and the tenancy migration own persistence.
- `packages/service/src/recipients.ts` owns recipient input/path schemas and service operations.
- Concrete Nitro handlers under the environment recipient collection and `apps/server/tests/recipients.integration.test.ts` own the HTTP/OpenAPI contract and runtime evidence.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- Recipient

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Upsert the same external ID in two environments and inspect only the authorized record through the service and its HTTP packets.
- Behavioral scenarios: Scoped identity collision; repeat upsert; wrong tenant; bounded deletion/no resurrection; collection pagination boundary.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
