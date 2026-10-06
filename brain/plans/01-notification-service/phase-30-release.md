# Release qualification

Back to [[plans/01-notification-service/overview]]

## Goal

Rehearse backup+key restoration, measured load/fairness/SSE envelope, provider device matrix and incident runbooks. Publish only exercised support claims and explicit provider prerequisites.

## Changes

- docs/operations.md
- docs/release-evidence.md
- tests/release-smoke.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- ReleaseEvidence, SupportedEnvelope

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Run the complete clean-install/real-provider/restore/load matrix from verification; all gates required before production designation.
- Behavioral scenarios: Restore RPO/RTO; benchmark envelope; real provider matrix; compromised-key response; complete contract coverage.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
