# Web Push delivery

Web Push is an internal worker capability. Provider consumers default to disabled;
set `PUSH_DELIVERY_ENABLED=true` and `WEB_PUSH_SUBJECT` to exercise them for
qualification. The sender takes the validated
`WEB_PUSH_SUBJECT` contact URI and the operator-owned egress policy. It uses
`web-push` request generation with `aes128gcm`, followed by the guarded HTTPS
transport described in [egress operations](./EGRESS.md).

Each send decrypts the immutable credential and endpoint generation from its
reservation. The subscription's application server key must match the reserved
VAPID public key and the public key derived from that version's private key.
VAPID credentials are supplied per request; no global keys or default credential
fallback is used. The audience includes the destination origin and port.

The plaintext limit is 3993 bytes including Pipong's notification and delivery
IDs. The generated encrypted body must also fit 4096 bytes. TTL uses remaining
whole seconds until notification expiry; urgency and replacement topic come from
the validated notification. Expired attempts settle without a request.

HTTP 201 records provider acceptance, which does not prove display. HTTP 404 and
410 are permanent subscription failures and disable only the attempted endpoint
generation. HTTP 401 and 403 are permanent credential/binding failures and leave
the endpoint active. HTTP 429 retries wait at least 60 seconds; HTTP 5xx retries
wait at least ten seconds. A longer Retry-After wins. Other successful statuses
and transport failures are ambiguous. Other HTTP errors are permanent. The
sender performs one request; fenced application settlement owns retries and
expires retry plans that exceed the notification deadline.

Only HTTP status and Retry-After enter the stored receipt. Provider response
bodies, endpoint URLs, subscription secrets, and VAPID keys are excluded. Receipt,
generation disablement, delivery state, event, admission release, and queue claim
completion commit together. A lost claim rolls back endpoint disablement.

Activating a new VAPID version does not migrate existing subscriptions. Keep
older bound versions usable while clients re-subscribe using the new public key;
explicit retirement follows the existing credential lifecycle. Registration and
public-key operations already exist in the REST API.

Local HTTPS fixtures verify encrypted requests, VAPID audience and version
rotation, byte limits, response classification, retry hints, and connect-time
screening. PostgreSQL fixtures verify generation-safe invalidation and lost-claim
rollback. Live service-worker delivery on Chrome, Firefox, and Safari (including
an installed iOS web app) remains a release qualification gate.

See the [web-push request generation API](https://github.com/web-push-libs/web-push#generaterequestdetailspushsubscription-payload-options)
and [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html) for the protocol contract.
