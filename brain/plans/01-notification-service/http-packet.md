# Required HTTP adapter packet

Back to [[plans/01-notification-service/overview]]

## Execution unit

- Repeat this packet once per operation below, immediately after its service capability works. Each repetition changes at most three primary files: the concrete Nitro method route, its HTTP integration test, and the OpenAPI contract.
- Use Nitro filesystem routing under apps/server/src/api, explicit .ts imports, Valibot boundary validation, shared authorization and RFC 9457 errors. Keep API paths unchanged by relocation. Do not introduce a catch-all mega-controller to satisfy a file-count limit.
- Name the route and response schema before implementation; keep business/SQL/provider logic in packages/service, not in handlers. Generated SQL/lockfiles are not a reason to combine unrelated operations.
- Routing: implementation codex/gpt-5.4 if available; authorization/contract review receives senior review. Use execute/nitro/ts-best-practices/testing/vitest/quality skills.

## Mandatory operations

- Projects: create, list, read, update, suspend, delete.
- Environments: create, list, read, update, suspend, delete.
- Service keys: issue, list metadata, rotate, revoke. No broad grant updates after issuance.
- Recipients: upsert, list, read, delete.
- Endpoints: register, list metadata, update/re-register, disable.
- Credentials: create version, list metadata, read metadata, activate, retire; publish VAPID public key.
- Notifications: submit, list, read summary, list deliveries, cancel.
- Deliveries: read outcome/attempts, redrive.
- Events: cursor-page replay, SSE stream.
- Health: liveness, readiness, protected metrics.
- Better Auth's native login/session/TOTP/organization-membership/invitation endpoints stay in its handler; do not duplicate them in /api/v1. Explicitly deny native endpoints that bypass key/deletion/enrollment policies.

## Verification for each repetition

- Static: check/test/build; generated OpenAPI validates the request and response schemas of that operation.
- Runtime: exercise the built Nitro HTTP route using real PostgreSQL and authorized client credentials, not just the underlying service function.
- At most five scenarios: valid result, invalid boundary input, cross-tenant/nested scope, insufficient or revoked authority, and the operation's meaningful concurrency/error boundary.
- Assert visible behavior/status/error code, never tests that merely echo forwarding calls or match source text.
- Record the operation in release contract coverage. Every listed operation must have evidence before phase 30 can pass.
