# Better Auth implementation audit

- Date: 2026-10-06. Scope: Better Auth 1.7.7 runtime, adapter, schema, HTTP policy, mail callbacks, and tests.
- Sources: installed package code/types and the v1.7 documentation selected through `https://better-auth.com/llms.txt`. Applied the Better Auth, security, email/password, organization, and two-factor skills.
- Intentional requirements: UUIDv7/PostgreSQL UUID keys and references, timestamp helpers, centralized relations, separate auth package, disabled public enrollment, and durable pg-boss auth mail.

## Findings

1. High: trusted-device MFA bypass remains enabled.
   - `packages/auth/src/auth.ts:73` uses the plugin defaults; `src/requests.ts` permits TOTP and backup-code verification without restricting `trustDevice`.
   - Better Auth creates a signed trust cookie and verification record when a caller submits `trustDevice: true`. Its sign-in hook then skips MFA for that device for 30 days and refreshes the trust period.
   - Reproduced against PostgreSQL through the actual HTTP handler: enroll, complete an MFA login with `trustDevice: true`, sign out, then sign in with only the password. A valid session is returned without `twoFactorRedirect`.
   - This violates [[plans/01-notification-service/security-and-operations]]; it is not a flaw in Better Auth's documented feature.
   - Recommended fix: enforce the no-trust policy in a native Better Auth before hook for both verification endpoints. Add regression coverage for TOTP and backup codes. Do not rely on hiding the option in a client or merely changing cookie duration.

2. Medium: security regression coverage is incomplete.
   - The existing MFA test verifies TOTP without device trust; backup-code consumption/replay, trusted-device requests, and account lockout across challenges are untested.
   - HTTP fixtures run with `NODE_ENV=test`; installed Better Auth disables its origin check by default in that environment. The explicit wrapper-origin test therefore does not establish production native origin/redirect behavior.
   - Recommended coverage: native origin/CSRF and callback-URL rejection with production-equivalent checks enabled, backup-code single use, and account-level MFA lockout. Preserve the real HTTP/PostgreSQL fixtures.

3. Low: plugin imports diverge from the integration skill.
   - Runtime and generation config import `organization` and `twoFactor` from the broad `better-auth/plugins` entrypoint.
   - The installed package supports dedicated `better-auth/plugins/organization` and `better-auth/plugins/two-factor` exports. Use those paths as the skill recommends. This is an import/bundling concern, not a demonstrated authentication failure.

## Correct integration and accepted customization

- Relations v2 adapter, `provider: 'pg'`, explicit auth schema mapping, transactions, and typed relations passed into `drizzle()` match the installed APIs.
- UUIDv7 generation is configured in Better Auth as well as the Drizzle helper. PostgreSQL UUID references align; string-valued external provider account identifiers remain text.
- Timestamp defaults cover extra columns without requiring Better Auth additional-field configuration. Nullable `deletedAt` columns do not implement soft deletion; Better Auth still hard-deletes sessions and verification records.
- Email verification is required; minimum password length is 12; default password hashing is used; reset revokes sessions. Existing tests cover reset completion and token reuse rejection.
- Database sessions and rate limits, disabled cookie caching, native security checks, canonical trusted origin, and server-controlled client IP follow the intended boundary. Proxy bucket sharing is documented.
- Durable mail enqueue is awaited intentionally. Do not replace it with untracked fire-and-forget delivery solely to copy a skill example.
- Public signup, organization mutations, raw key mutations, user deletion, MFA disable, and backup-code regeneration remain blocked intentionally.
- Invitation completion and recent-MFA assurance are phase-06 work. The configured invitation URL currently targets a blocked endpoint; complete that flow before enabling invitations.

## Validation and limits

- Temporary targeted HTTP/PostgreSQL test reproduced trusted-device bypass; removed afterward. Production code was not changed during this audit.
- Static checks passed after report creation. Earlier full verification passed 44 tests, including actual relational queries and mail delivery; those tests did not cover the identified policy gap.
- No complete audit of Better Auth internals, deployed proxy configuration, browser clients, or future privileged enrollment routes was performed.
- Documentation: [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [two-factor authentication](https://better-auth.com/docs/plugins/2fa).
