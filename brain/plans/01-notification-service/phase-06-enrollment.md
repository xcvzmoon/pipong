# Operator-assisted enrollment

Back to [[plans/01-notification-service/overview]]

## Goal

Provide local-only bootstrap, account provisioning, verification/invitation/reset flows, TOTP enrollment/recovery, and recent-MFA assurance for privileged actions. Use supported auth APIs and queue authentication email through pg-boss. The worker sends it through Unemail with Handlebars templates and configured SMTP.

## Changes

- apps/worker/src/operator.ts
- packages/service/src/enrollment.ts
- tests/enrollment.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- EnrollmentAction, PrivilegedAssurance

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Bootstrap through protected input and complete invite/verification/MFA using a local SMTP capture service and operator client; no usable remote bootstrap exists.
- Behavioral scenarios: Concurrent bootstrap; verified invite acceptance; canceled invite; MFA step-up; recovery audit.
- Prove mail survives a worker restart and temporary SMTP failures retry within a bounded policy. Keep this verification in a separate mail packet if the enrollment packet exceeds its scenario limit.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
