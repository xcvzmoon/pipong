# FCM delivery

FCM HTTP v1 is implemented as an internal worker capability. Provider queue
consumers remain disabled until the remaining provider and recovery phases are
qualified. The adapter uses each delivery's pinned credential version and sends
to the target project in that credential's `appId`.

The credential service account's `projectId` may differ from the target project.
In that case, grant the service account permission to send messages in the target
Firebase project. The adapter never falls back to ambient application credentials.
Google OAuth access is scoped to
`https://www.googleapis.com/auth/firebase.messaging` and cached only within the
immutable credential version's bounded client entry.

The adapter posts one request to
`https://fcm.googleapis.com/v1/projects/{target-project}/messages:send`. It rejects
redirects, has a ten-second total deadline, and reads at most 8 KiB of response
body. Each send has its own deadline while OAuth refreshes are shared. When a send
times out, it leaves the shared refresh; the exchange stays open for other active
sends and is cancelled after the last send leaves. Shutdown aborts active token
exchanges and blocks late sends. If a notification
expires during authentication, settlement records the attempt, delivery, event, and
admission release as expired. Expiry is checked again after authentication, before
the request starts. Temporary OAuth transport/server failures are
retryable; invalid OAuth credentials are permanent. Gaxios retries are explicitly
disabled for token exchange. OAuth HTTP status is stored separately from the FCM
HTTP receipt, without persisting the response body. A fetch/network failure or
malformed response is ambiguous. No FCM SDK send method or automatic send retry
is used; application settlement owns retries.

New endpoint registrations can use a Firebase Installation ID (`fid`). Existing
registration identifiers remain supported and are sent as the HTTP v1 `token`
field for migration compatibility. Google's current Message reference marks
`token` deprecated in favor of `fid`. Both target kinds are encrypted and bound to
the endpoint generation and credential version.

A successful response is accepted only with a nonempty
`projects/{project}/messages/{id}` name and no error body; acceptance does not
prove receipt or display on a device. The adapter preserves HTTP status, message
name, FCM error status/code, a fixed quota category, and `Retry-After`. Quota
subjects, descriptions, and arbitrary reason identifiers are not persisted. Known
429/5xx status and retry floors are retained when a response body stalls. HTTP 429 retries wait at least 60 seconds, including
`QUOTA_EXCEEDED`; a longer Retry-After wins. HTTP 5xx retries wait at least ten
seconds and honor a longer hint. Other provider errors are permanent. Only an
explicit, validated `UNREGISTERED` FCM error disables the
attempted endpoint generation. `INVALID_ARGUMENT`, sender mismatch, and auth
failures do not disable endpoints.

The current [FCM Message reference](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)
documents FID targeting and the deprecated token field. Firebase's [error guidance](https://firebase.google.com/docs/cloud-messaging/error-codes)
and [quota guidance](https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas)
describe retry evidence and project-level limits.

Controlled local HTTP and PostgreSQL fixtures cover target serialization,
project routing, real google-auth-library/Gaxios token exchange, retry behavior
and request cancellation, response classification, retry hints, expiry settlement,
and generation-fenced invalidation including lost-claim rollback. A registered
Android installation and Firebase project are not available in this environment,
so live project IAM and device delivery remain release qualification gates.
