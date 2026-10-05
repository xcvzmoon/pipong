# Research sources and version risks

Back to [[plans/01-notification-service/overview]]

## Repository evidence

- package.json, pnpm-workspace.yaml, nitro.config.ts, server/api/index.ts, vitest.config.ts, existing CI/release workflows, and installed Nitro documentation were inspected. No product implementation or suite was found in the mapped starter surface.
- Installed Nitro 3.0.260903-beta resolves H3 2.0.1. Installed examples may use older SSE helpers. Verify H3 EventStream and lifecycle cleanup against the built app.
- Current registry/release versions observed by research include Better Auth/API-key 1.7.7, pg-boss 12.36.0, and @parse/node-apn 8.1.0. They are compatibility candidates, not dependencies installed or certified by this plan.

## Primary documentation

- [Nitro Node deployment](https://nitro.build/deploy/runtimes/node), [plugins](https://nitro.build/docs/plugins), [tasks](https://nitro.build/docs/tasks), [WebSocket/SSE](https://nitro.build/docs/websocket).
- [H3 2.0.1 EventStream source](https://github.com/h3js/h3/blob/v2.0.1/src/utils/event-stream.ts), [SSE protocol/EventSource](https://html.spec.whatwg.org/multipage/server-sent-events.html).
- [Better Auth organizations](https://better-auth.com/docs/plugins/organization), [organization-owned keys](https://better-auth.com/docs/plugins/api-key/advanced#organization-owned-api-keys), [key reference](https://better-auth.com/docs/plugins/api-key/reference).
- [Better Auth Nitro integration](https://better-auth.com/docs/integrations/nitro), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [session revocation/cache](https://better-auth.com/docs/concepts/session-management), [rate limits](https://better-auth.com/docs/concepts/rate-limit), [TOTP](https://better-auth.com/docs/plugins/2fa), [security](https://better-auth.com/docs/reference/security).
- [pg-boss transaction adapters](https://pgboss.io/api/adapters), [version-pinned 12.36.0 adapters](https://github.com/timgit/pg-boss/blob/12.36.0/docs/api/adapters.md), [job/retry options](https://pgboss.io/api/jobs), [worker settlement/concurrency](https://pgboss.io/api/workers).
- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html), [LISTEN](https://www.postgresql.org/docs/current/sql-listen.html).
- [Apple token connections/key scope](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns), [APNs requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns), [APNs errors/retry/invalidation](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns).
- [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api), [current Message/FID schema](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages), [errors/retry](https://firebase.google.com/docs/cloud-messaging/error-codes), [TTL/acceptance](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan), [registration lifecycle](https://firebase.google.com/docs/cloud-messaging/manage-tokens).
- [RFC 8030 Web Push/TTL](https://www.rfc-editor.org/rfc/rfc8030), [RFC 8291 encryption/size](https://www.rfc-editor.org/rfc/rfc8291), [RFC 8292 VAPID](https://www.rfc-editor.org/rfc/rfc8292).
- [web-push request generation/transport](https://github.com/web-push-libs/web-push), [APNs client](https://github.com/parse-community/node-apn), [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
- [iOS Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [RFC 9457 errors](https://www.rfc-editor.org/rfc/rfc9457.html).
- [Reference product](https://github.com/productdevbook/nitroping-push) is inspiration for capability scope, not evidence that GraphQL or its delivery implementation is appropriate here.

## Resolve before release

- Pin matching auth/plugin/adapter/CLI schemas and confirm organization key ownership, native endpoint disabling, expiry units, transaction boundaries, recent MFA assurance, and membership races.
- Audit APNs automatic resend behavior, raw 410 timestamp preservation, environment-scoped keys, HTTP/2 close/GOAWAY and deadline control before enabling production sends.
- Confirm released Firebase client FID enrollment and HTTP v1 target behavior; current documentation mixes new FIDs with older registration-token examples. No outdated InstanceID integration.
- Prove queue lease/complete/successor options against pinned pg-boss, including [id+retryCount claim settlement and affected counts](https://github.com/timgit/pg-boss/blob/12.36.0/docs/api/jobs.md#passing-jobs-instead-of-ids). Current unversioned docs are not enough. Keep network I/O outside its transactional worker callback.
- Prove guarded Web Push transport honors actual connection-time DNS/TLS policy and byte/deadline limits. Library encryption alone is not network security.
- Real provider credentials, signed client apps, physical devices/browsers, HA infrastructure and backup storage are implementation/release prerequisites not present in this repository.
