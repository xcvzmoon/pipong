# Encrypted credential versions

Back to [[plans/01-notification-service/overview]]

## Goal

Implement AEAD-protected credentials/endpoint secrets and immutable provider versions with tenant-bound authenticated context. Provide metadata reads, activation/retirement and keyring rotation without leaking secrets.

## Changes

- packages/service/src/credentials.ts
- packages/service/src/secrets.ts
- tests/credentials.integration.test.ts

- Commit generated SQL/lockfile changes required by this capability; review its documented contract. Do not edit vendored skills or anti-slop tooling.
- Service capabilities require the HTTP adapter packets in [[plans/01-notification-service/http-packet]]; neither service-only smoke nor this file list excuses missing public operations.

## Data structures

- CredentialVersion, EncryptedValue

## Routing

- Execution: codex/gpt-6-luna as selected by the user, if available; do not silently substitute an unavailable requested model. Architecture/security judgment receives senior review. This is routing guidance, not a requirement to use a particular vendor to implement the product.

## Verification

- Static: install before first typecheck; pnpm check, applicable Vitest tests, and affected deployable build. Tests use isolated real PostgreSQL/protocol fixtures, not module mocks.
- Runtime: Create/read metadata/rotate credentials against PostgreSQL; ciphertext moved to another tenant fails authentication and unavailable keys fail closed.
- Behavioral scenarios: Ciphertext context; once-only secret handling; credential retirement; encryption-key rotation; cache eviction.
- Update user/operator docs for delivered behavior; this internal increment is not the full production release.
