# Provider contracts

Back to [[plans/01-notification-service/overview]]

## Common boundary

- Three typed adapters, not a universal notification bag. Validate final serialized bytes and preserve categorized provider error/status, retry hints, and correlation IDs.
- Prefer maintained integrations: @parse/node-apn for APNs, google-auth-library plus direct FCM HTTP v1 for OAuth and observable HTTP outcomes, web-push for VAPID/encryption with guarded transport.
- Audit exact released versions before adoption: Node 24 ESM compatibility, raw error fidelity, timeout/shutdown behavior, connection caching, and automatic retries. Direct FCM HTTP v1 avoids hiding Retry-After or current FID targeting behind an older SDK.
- Scope client caches to organization/environment/provider application/credential version. Bound cache size, close retired clients, and never use global mutable credentials.
- Self-hosted refers to Pipong's control plane and storage. Native mobile/browser push still depends on Apple, Google, and browser push services and sends data outside the deployment. Use minimal payloads, not sensitive documents.

## APNs

- Native HTTP/2 to explicit sandbox/production endpoints; .p8 token authentication with Key ID, Team ID, topic, and environment/key scope. Do not infer APNs environment from NODE_ENV.
- Initial scope: alert and background pushes. Validate push-type/priority combinations, topic, expiry in epoch seconds, and collapse ID <=64 bytes. Specialized VoIP/Live Activities require separate explicit contracts.
- Final ordinary payload <=4096 bytes. Cache JWTs within Apple's refresh guidance and isolate connections by authorized developer account/key/topic scope.
- Record 200 as provider_accepted and preserve apns-id. For 410, preserve invalidation timestamp in epoch milliseconds and generation-check before disabling the endpoint.
- Treat wrong topic/environment/auth as binding/configuration failures, not blanket recipient deletion. Apple's current guidance delays 5xx retries at least 15 minutes; expire rather than retry if the deadline cannot accommodate that delay.

## FCM

- Direct HTTP v1 messages:send to the explicit target Firebase project. google-auth-library obtains/refreshes OAuth tokens using firebase.messaging scope and tenant credential version.
- Current official Message schema prefers fid and deprecates token. Endpoint input/storage discriminates FID vs registration token; prefer FID for new client integrations and confirm released client registration behavior. No token-only schema or obsolete InstanceID/device-group feature.
- Each environment binds a target project; credential service-account project may differ only with valid target-project IAM permission. Never use instance ADC as an implicit credential for all tenants.
- Standard payload <=4096 bytes including keys/values; data is string-to-string with reserved-key restrictions. TTL <=28 days and HTTP v1 duration in seconds; no Admin-SDK milliseconds leaking into the public API.
- UNREGISTERED invalidates only the attempted generation. INVALID_ARGUMENT is not blanket token invalidation; SENDER_ID_MISMATCH and auth failures are configuration/binding errors.
- Honor Retry-After for transient errors; quota retries have provider-specific minimum delays (typically >=1 minute). Preserve quota reason rather than classifying all 429s identically. A message name means acceptance, not receipt.

## Web Push

- Store endpoint, p256dh, auth, optional expirationTime, and VAPID credential binding. Publish only the VAPID public key for subscription creation.
- web-push generates RFC 8291 aes128gcm request details; guarded Node HTTPS transport enforces destination checks, deadlines, response limits, and no redirects. Do not reimplement encryption.
- Portable plaintext bound is 3993 bytes with minimum RFC overhead; count added metadata/padding. TTL is integer seconds; urgency/topic follow RFC 8030 (topic is replacement, not broadcast).
- VAPID rotation does not automatically migrate public-key-bound subscriptions. Keep old versions usable until re-subscription/drain, or explicitly invalidate/re-enroll those subscriptions.
- Confirmed 404/410 missing subscription is terminal; 401/403 is credential/binding failure; 429/5xx/network errors follow bounded provider policy. 201 means accepted, not displayed.
- Allow arbitrary public HTTPS push origins subject to connect-time DNS/IP filtering and strict TLS. Operator-only exact origin/port/CIDR exceptions may permit private self-hosted push services; tenants cannot create egress exceptions.

Sources and provider prerequisites: [[plans/01-notification-service/sources]] and [[plans/01-notification-service/verification]].
