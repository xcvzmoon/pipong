# Notification status

Use these paths under
`/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}`:

| Request                                          | Result                                        | Permission          |
| ------------------------------------------------ | --------------------------------------------- | ------------------- |
| `GET /notifications`                             | Paginated notification summaries              | `notification:read` |
| `GET /notifications/{notificationId}`            | One notification summary                      | `notification:read` |
| `GET /notifications/{notificationId}/deliveries` | Paginated delivery IDs, providers, and states | `delivery:read`     |
| `GET /deliveries/{deliveryId}`                   | Delivery state and redacted attempt history   | `delivery:read`     |

Human sessions and environment-bound service keys use the same live authorization
checks as submission. Foreign resources return 404. Suspended environments remain
readable. Responses have `Cache-Control: no-store`.

A summary contains `id`, `acceptedAt`, `expiresAt`, `canceledAt`, `deliveryCount`,
`counts`, and `providerAcceptance`. Counts group queued, sending, and retry-wait
work into `pending`; terminal groups are `providerAccepted`, `failed`, `expired`,
and `canceled`. Provider acceptance is counted separately for APNs, FCM, and
Web Push. Counts come from one database statement snapshot. `provider_accepted`
means the provider accepted the request; it does not prove device receipt or display.
Expiry time alone does not change state; status reflects committed worker results.

Delivery attempts contain `generation`, `retryCount`, `startedAt`, `finishedAt`,
and `outcome`. An unfinished attempt has null finish time and outcome. Completed
outcomes are `accepted`, `permanent`, `transient`, or `ambiguous`. Delivery state
and its attempts share one statement snapshot. Payloads, endpoint targets, tokens,
credential IDs, job IDs, provider codes, and raw receipts are omitted.

Collections accept `limit` from 1 to 100 (default 50), and an optional opaque
`cursor`. Pages contain `items` and `nextCursor`; null means no further page was
found. Cursors are bound to the environment and collection, and delivery cursors
also bind the parent notification. Malformed or mismatched cursors return 422
`RESOURCE_CURSOR_INVALID`. Concurrent state changes can change later pages;
this is a live view, not a frozen export.

Run migrations before deployment. The new attempt-read policy permits API reads
only within the active tenant scope; worker write permissions stay unchanged.

For live updates and reconnect replay, see [delivery events](./EVENTS.md).
