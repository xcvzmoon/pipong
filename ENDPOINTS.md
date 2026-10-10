# Recipient endpoints

A trusted application backend registers installations for an active recipient. Use
an environment-bound service key with `endpoint:write`, or an authorized owner/admin
session. Keep service keys on the backend. Client devices must not receive them.
The backend must verify the application's user and recipient mapping before forwarding
a registration; Pipong recipients are separate from Better Auth users.

All paths start with
`/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/recipients/{recipientId}/endpoints`.

| Method and suffix            | Action           | Result                              |
| ---------------------------- | ---------------- | ----------------------------------- |
| PUT collection               | `endpoint:write` | Register or refresh an installation |
| GET collection               | `endpoint:read`  | Paginated redacted metadata         |
| GET `/{endpointId}`          | `endpoint:read`  | Redacted metadata                   |
| POST `/{endpointId}/disable` | `endpoint:write` | Disable the selected generation     |

Writes require JSON and accept at most 16 KiB. Unknown properties and invalid
provider inputs return `422 RESOURCE_INPUT_INVALID`. All successful operations return
200, with `cache-control: no-store` and `x-request-id` headers. Errors use the shared
problem response. The generated OpenAPI document describes each operation and input.

## Registration

Every input includes `provider`, `appId`, `credentialId`, `installationId`, and
`target`. The credential must be active in the same environment and match the
provider and application. `installationId` is a stable backend-owned identifier
containing 1–200 letters, digits, dots, underscores, or hyphens. Its endpoint stays
bound to the original recipient, provider, and application. A conflicting recipient
returns `409 ENDPOINT_INSTALLATION_CONFLICT`.

APNs uses a hexadecimal device token and an explicit `sandbox` or `production`
environment matching the credential. Hexadecimal input is normalized to lowercase.
Tokens may contain 1–512 bytes; this is Pipong's input limit. Apple documents
[variable token lengths](<https://developer.apple.com/documentation/uikit/uiapplicationdelegate/application(_:didregisterforremotenotificationswithdevicetoken:)>),
so the API does not require a fixed 32-byte token.

```json
{
  "provider": "apns",
  "appId": "com.example.app",
  "credentialId": "019a0000-0000-7000-8000-000000000001",
  "installationId": "phone-42",
  "target": { "token": "0123456789abcdef", "environment": "sandbox" }
}
```

FCM discriminates `target.kind` as `fid` or `registration-token`, with the identifier
in `target.value`. The credential's target application must match `appId`. A service-account project may differ; the delivery adapter must verify target-project IAM permissions. FID input follows the
[Firebase SDK's identifier pattern](https://github.com/firebase/firebase-js-sdk/blob/main/packages/installations/src/helpers/generate-fid.ts).
FCM's [current message contract](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)
supports FIDs and retains registration tokens in its deprecated `token` field. New
client integrations should register FIDs.

```json
{
  "provider": "fcm",
  "appId": "sample-project",
  "credentialId": "019a0000-0000-7000-8000-000000000002",
  "installationId": "android-42",
  "target": { "kind": "fid", "value": "caaaaaaaaaaaaaaaaaaaaa" }
}
```

Web Push `target` contains `endpoint`, `p256dh`, `auth`, optional nullable
`expirationTime` in epoch milliseconds, and `applicationServerKey`. Public keys must
be canonical base64url uncompressed P-256 points; `auth` encodes 16 bytes.
`applicationServerKey` must match this immutable VAPID credential's public key.
Read that key through the credential public-key operation before subscribing.
Registration checks the endpoint against the operator's [egress policy](./EGRESS.md).
No notification is sent during registration. Delivery must repeat destination checks
at send time. DNS failures return 503; blocked or invalid destinations return 422.

An inactive, retired, mismatched, or incorrectly bound credential returns
`409 ENDPOINT_BINDING_INVALID`. Missing or out-of-scope resources return
`404 RESOURCE_NOT_FOUND`. Active targets are unique within the provider application
and environment. A duplicate target in another installation returns
`409 ENDPOINT_TARGET_CONFLICT`; no provider identifier appears in the error.

## Generations and disable ordering

Each confirmation advances the generation, even when the identifier is unchanged.
Re-registering a disabled installation reactivates it with a new generation. Token
and subscription snapshots are encrypted with tenant, endpoint, recipient, provider,
installation, generation, and credential binding. Old snapshots remain available for
future pinned delivery attempts. Runtime roles cannot rewrite or delete them.
Retain encryption keys needed by retained snapshots.

Disable with the generation returned in metadata:

```json
{ "generation": 3 }
```

A stale generation returns `409 ENDPOINT_GENERATION_STALE`. Repeated disable of the
same generation preserves its timestamp. Concurrent confirmation and disable are
serialized: a newer confirmed generation survives an older disable. Internal provider
invalidation also checks the attempted generation. APNs invalidation timestamps must
be at least the registration time before that generation can be disabled; clients
cannot supply provider invalidation timestamps through the public API.

Metadata contains ownership, recipient/installation IDs, provider/application,
credential version, generation, state, and creation/registration/disable timestamps.
It excludes identifiers, subscription URLs, keys, ciphertext, and target hashes.
Lists include disabled endpoints, accept `limit` from 1 to 100 (default 50), and
return `nextCursor`. Cursors are bound to the recipient, collection, and environment.
Deleted recipients cannot register, disable, or inspect endpoints. Suspended scopes
reject endpoint writes. Delivery admission and provider consumers are later phases.
