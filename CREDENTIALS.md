# Provider credential versions

Credentials belong to one organization, project, and environment. Owners and admins can inspect metadata. Mutations require recent MFA; service keys cannot manage or inspect credential versions. Members and service keys with `endpoint:read` can fetch an active version's VAPID public key.

All paths below start with `/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/credentials`.

| Method | Suffix                              | Operation                                          |
| ------ | ----------------------------------- | -------------------------------------------------- |
| POST   | `/`                                 | Create an inactive immutable version               |
| GET    | `/`                                 | List metadata with `limit` and `cursor`            |
| GET    | `/{credentialId}`                   | Read metadata                                      |
| POST   | `/{credentialId}/activate`          | Activate a version                                 |
| POST   | `/{credentialId}/retire`            | Permanently retire a version                       |
| POST   | `/{credentialId}/rotate-encryption` | Reencrypt under the current active encryption key  |
| GET    | `/{credentialId}/public-key`        | Read an active Web Push version's VAPID public key |

Create requests require JSON, reject extra fields, and are limited to 32 KiB. Supply `provider`, `appId`, and a typed `secret`:

- `apns`: `appId` is the APNs topic. The secret contains `teamId`, `keyId`, `environment` (`production` or `sandbox`), and a PEM P-256 `privateKey`. Team and key IDs contain ten uppercase letters or digits.
- `fcm`: `appId` is the target Firebase project. The secret contains the service account's `projectId`, `clientEmail`, and PEM RSA `privateKey` of at least 2048 bits. Cross-project sending still requires target-project IAM permission when the FCM adapter ships.
- `web-push`: `appId` identifies the application. The secret contains a 43-character base64url P-256 private scalar in `privateKey`. The service derives the public key from it.

Responses never contain private keys or ciphertext. Metadata includes the version UUID, ownership IDs, provider, application ID, nullable VAPID public key, state, creation time, and nullable retirement time. The UUID is the immutable version identifier. Pagination defaults to 50, allows 1–100, and binds cursors to the environment and credential collection.

Activation authenticates the stored secret before changing state. At most one version is active for each environment/provider/application binding. Concurrent activations serialize. The former active version becomes inactive and retains its secret for future pinned delivery work. Retirement is permanent and idempotent; it preserves the first retirement timestamp. Creating a new version is the way to change a provider secret.

Push delivery consumers are not enabled yet. Before they ship, retirement must reject versions pinned by pending work unless that work is deliberately rebound and audited. Endpoint registration and provider client caches belong to later phases. This implementation caches neither plaintext nor encryption keys.

## Encryption keyring

Set `CREDENTIAL_KEYRING_REF` to an absolute path to an operator-owned JSON file, mounted outside PostgreSQL and the source checkout. Restrict file access to the app accounts. API replicas must receive the same keyring; workers will need it when encrypted delivery data is introduced.

The file has this shape; replace placeholders with independently generated 32-byte keys encoded as 64 lowercase hexadecimal characters:

```json
{
  "activeKeyId": "key-2026-10",
  "keys": {
    "key-2026-10": "<64 lowercase hexadecimal characters>"
  }
}
```

The keyring allows 1–32 keys and at most 8192 bytes. Key IDs contain 1–64 letters, digits, underscores, or hyphens. The active ID must exist. Each encryption operation reloads the file; deploy replacements atomically so requests never read partial JSON. There is no fallback to an environment secret or database key.

Secrets use [Node's AES-256-GCM implementation](https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html), fresh 96-bit random nonces, and 128-bit authentication tags. Authenticated context includes the envelope/key version, tenant hierarchy, resource ID, purpose, and provider/application/public-key binding. A moved or altered envelope fails authentication. The same encryption functions support endpoint secrets when endpoint registration is implemented.

To rotate encryption keys:

1. Distribute a keyring containing both old and new keys to every replica, keeping the old key active.
2. Switch the active ID to the new key on every replica while retaining old keys.
3. Page through every environment's credential versions, including inactive and retired versions, and call `rotate-encryption` for each UUID. This operation preserves provider identity and lifecycle. Retry failed operations before proceeding.
4. Verify every stored envelope uses the new key ID using an operator database inspection. Keep old keys with any backups that still contain old envelopes.
5. Remove the old key from live keyrings only after all live encrypted data has been rotated. Future endpoint and message tables must also be included once implemented.

Missing keys or failed authentication return `503 AUTHORIZATION_UNAVAILABLE` through the HTTP transaction boundary and leave state unchanged. Internal encryption errors use `CREDENTIAL_KEYRING_INVALID`, `CREDENTIAL_KEY_UNAVAILABLE`, and `CREDENTIAL_DECRYPT_FAILED`, without secret values. Metadata reads and retirement remain available without decryption. Retired activation returns `409 CREDENTIAL_RETIRED`; public-key reads for inactive, retired, or non-Web-Push versions return `409 CREDENTIAL_NOT_ACTIVE_WEB_PUSH`.

Back up keyrings separately from the database and rehearse restoring both. A database backup alone cannot recover encrypted credentials.
