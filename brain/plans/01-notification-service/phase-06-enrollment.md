# Operator-assisted enrollment

Back to [[plans/01-notification-service/overview]]

## Status

- Complete, 2026-10-07. Verified built API/operator/worker against disposable PostgreSQL 18 and local SMTP capture.
- `pnpm install`, `pnpm check`, `pnpm build`, and full tests passed. All 21 server tests and the separate 10-test persistence suite passed; existing mail tests cover restart and bounded SMTP retry.
- Audit append-only grants are tested with the API runtime role.

## Goal

Provide local-only bootstrap, account provisioning, verification/invitation/reset flows, TOTP enrollment/recovery, and recent-MFA assurance for privileged actions. Use supported auth APIs and queue authentication email through pg-boss. The worker sends it through Unemail with Handlebars templates and configured SMTP.

## Implementation packets

- Local enrollment: `apps/worker/src/operator.ts`, `packages/auth/src/enrollment.ts`, and `apps/server/tests/enrollment.integration.test.ts`.
- Native policy: `packages/auth/src/assurance.ts`, `packages/auth/src/auth.ts`, and `packages/auth/src/requests.ts`.
- Persistence: database owns assurance/audit tables, enrollment and MFA queries, transaction mechanics, and generated migrations. Auth owns enrollment and MFA policy.
- Build/script wiring and operator instructions belong to these packets; no `packages/service` enrollment layer is needed.

## Delivered behavior

- Stdin-only local operator entrypoint; API credentials, Valibot validation, no listener or secret output.
- Serialized empty-install bootstrap; native Better Auth account/organization APIs and pg-boss mail enqueue share a Drizzle transaction.
- Provisioned accounts verify email before login; native verified invitations grant only member access.
- Five-minute session-bound MFA assurance guards invite/cancel, MFA disable, enrolled TOTP URI access, and backup-code regeneration.
- Backup-code recovery records user/session IDs without secrets; logout/revocation removes assurance.
- MFA disable requires password and recent MFA, rotates the session, and removes assurance. Recovery uses an existing backup code, followed by disable/re-enrollment.
- Privileged enrollment actions append audit records; API grants prohibit audit updates/deletions.
- Five built HTTP/operator scenarios cover concurrency, enqueue rollback, verified invitation/SMTP delivery, cancellation, and step-up/recovery auditing.

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- `EnrollmentAction`, `EnrollmentResult`, and session-bound `mfa_assurance` rows.

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Bootstrap through protected input and complete invite/verification/MFA using a local SMTP capture service and operator client; no usable remote bootstrap exists.
- Behavioral scenarios: Concurrent bootstrap; verified invite acceptance; canceled invite; MFA step-up; recovery audit.
- Prove mail survives a worker restart and temporary SMTP failures retry within a bounded policy. Keep this verification in a separate mail packet if the enrollment packet exceeds its scenario limit.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
