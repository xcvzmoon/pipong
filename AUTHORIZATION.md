# Domain authorization

Pipong authenticates `/api/v1` requests with a Better Auth session cookie or an
organization-owned service key. Send a key in `Authorization: Bearer <key>` or
`X-API-Key`. Requests containing both key headers, or a session cookie and a key,
return `401 AUTH_CREDENTIALS_AMBIGUOUS`. Keys never create human sessions.

An explicit Origin must match `AUTH_BASE_URL`. Cookie-authenticated mutations
require that Origin, including requests from non-browser clients. Session-cookie
caching and session refresh are disabled for domain authentication. The native
`/api/auth` handler keeps its existing enrollment and endpoint policies.

## Human permissions

Membership is checked against the organization in the requested resource scope.
The session's active organization and client-supplied role or MFA headers do not
establish authority. Only the exact `owner`, `admin`, and `member` roles are
recognized; missing, duplicated, combined, and custom memberships fail closed.
The user must still have a live session and a verified, undeleted account.

Owners may perform every domain action. Admins may perform every action except
`organization:manage`. Members may read projects, environments, recipients,
endpoint metadata, notifications, delivery outcomes, and events. Members cannot
send notifications, change resources, or inspect credential and key metadata.

Organization, project, environment, credential, and service-key management, plus
delivery redrive, require enrolled TOTP and a successful TOTP or backup-code
verification within the last five minutes in the current session. Future-dated
assurance records are rejected. Use the native MFA verification endpoints to
renew assurance. Client flags, passwords, and enrollment alone cannot replace it.

Project actions accept organization or project scope. Environment actions accept
project or environment scope. Organization management requires organization
scope. Other actions require an explicit environment scope.

## Service-key permissions

A verified key requires a live row in `auth.service_key_grants`. Each grant binds
one key to one organization, project, and environment, with explicit action names.
Composite foreign keys enforce the key's organization ownership and the
environment's complete ownership chain. Grants are authorization records, like
memberships, and are read before setting tenant context. Application resource
queries remain behind FORCE RLS. The worker cannot read authentication tables.

Keys may receive recipient and endpoint reads/writes, notification
reads/send/cancel, delivery reads, and event reads. A stored grant cannot give a
key organization/project/environment management, secret or key management,
credential metadata, or delivery redrive. No wildcard or implicit parent-scope
permissions are accepted. A sibling environment requires its own key.

Membership changes affect human access immediately. Organization-owned keys
survive the creator's departure, but key disablement, deletion, expiration, and
grant removal are checked on every operation. `auth.organizations.disabled_at`
blocks domain access for both humans and keys. Soft-deleted organizations,
projects, environments, users, sessions, keys, and grants cannot authorize work.

Key issuance, rotation, and revocation endpoints are phase 10 work. Native key
mutation endpoints remain disabled. This phase supplies the authorization
boundary without exposing a temporary issuance or diagnostic API.

## Transaction boundary

Use `withAuthorizedRequest` in Nitro handlers and `withAuthorizedTransaction`
in service capabilities. Pass a server-selected action and a validated scope;
never take the action or principal from a public request body. Perform the
operation through the supplied transaction. Do not return a reusable permission
flag and open a separate transaction for the operation.

Authorization reads PostgreSQL for each operation. It locks the organization,
then the principal's session/user/membership or key/grant, then the scoped project
and environment. Management actions acquire update locks on the resources they
manage; other actions acquire shared locks. Tenant context is transaction-local
and is set only after authority has been checked. Nested IDs must match the
requested ownership chain, even for an owner.

Removal, demotion, disablement, and revocation wait for operations that have
already acquired authority locks. After the change commits, later operations are
denied. Keep these transactions short and limited to database work; do not hold
locks while calling a push provider or streaming events. Future SSE handlers must
recheck authority between bounded observation transactions.

Errors use `application/problem+json`, stable codes, a generated request ID, and
`Cache-Control: no-store`. Absent authority and mismatched ownership return
`404 AUTH_SCOPE_NOT_FOUND`; insufficient permissions return
`403 AUTH_PERMISSION_DENIED`. Recent MFA and disabled organizations have separate
403 codes. Key throttling returns `429 AUTH_KEY_RATE_LIMITED` with `Retry-After`.
Authentication or transaction lookups that throw return 503. Pipong logs stable
failure codes and omits exception details from its responses and logs.

## Verification

Apply migrations with `pnpm migrate`. Build and run the integration suite against
a disposable PostgreSQL 18 cluster as described in
[AUTHENTICATION.md](./AUTHENTICATION.md). The authorization suite builds a separate
Nitro fixture using the real middleware, auth engine, and service transaction.
Its test endpoint is absent from the normal server build.

The suite covers the full role/action matrix, active-organization switching,
forged context, membership removal/demotion, MFA age, disabled organizations,
nested ownership, sibling environments, missing and revoked grants, expired and
disabled keys, key throttling, session revocation, mixed credentials, and origins.
It also proves that membership removal and grant deletion wait for an authorized
transaction and that subsequent HTTP requests are denied.
