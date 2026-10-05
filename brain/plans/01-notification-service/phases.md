# Implementation order

Back to [[plans/01-notification-service/overview]]

## Milestones

- Foundation: phases 01–04, including the bounded [[plans/01-notification-service/workspace-relocation]] packets in phase 01. Relocated apps/server, built worker, validated configuration, real PostgreSQL/migrations.
- Secure tenancy: phases 05–14. Human enrollment, MFA, explicit authorization, keys, recipients/endpoints, encrypted credentials and egress.
- Durable delivery core: phases 15–20. Validated payloads, queue, ordered events, distributed admission, atomic submission and fenced attempts.
- Provider completeness: phases 21–24. Native APNs, FCM HTTP v1, Web Push, retries/cancel/redrive.
- Operational visibility: phases 25–27. SSE/status, erasure/retention, metrics/audit.
- Production qualification: phases 28–30. Shipped installation, CI/release gates, real-device/load/restore evidence.

## Ordered packets

1. [[plans/01-notification-service/phase-01-workspace]]
2. [[plans/01-notification-service/phase-02-worker-build]]
3. [[plans/01-notification-service/phase-03-config]]
4. [[plans/01-notification-service/phase-04-persistence]]
5. [[plans/01-notification-service/phase-05-auth]]
6. [[plans/01-notification-service/phase-06-enrollment]]
7. [[plans/01-notification-service/phase-07-isolation]]
8. [[plans/01-notification-service/phase-08-authorization]]
9. [[plans/01-notification-service/phase-09-projects]]
10. [[plans/01-notification-service/phase-10-service-keys]]
11. [[plans/01-notification-service/phase-11-recipients]]
12. [[plans/01-notification-service/phase-12-credentials]]
13. [[plans/01-notification-service/phase-13-egress]]
14. [[plans/01-notification-service/phase-14-endpoints]]
15. [[plans/01-notification-service/phase-15-contract]]
16. [[plans/01-notification-service/phase-16-queue]]
17. [[plans/01-notification-service/phase-17-events]]
18. [[plans/01-notification-service/phase-18-admission]]
19. [[plans/01-notification-service/phase-19-submission]]
20. [[plans/01-notification-service/phase-20-attempts]]
21. [[plans/01-notification-service/phase-21-apns]]
22. [[plans/01-notification-service/phase-22-fcm]]
23. [[plans/01-notification-service/phase-23-web-push]]
24. [[plans/01-notification-service/phase-24-recovery-policy]]
25. [[plans/01-notification-service/phase-25-observation]]
26. [[plans/01-notification-service/phase-26-tenant-erasure]]
27. [[plans/01-notification-service/phase-27-observability]]
28. [[plans/01-notification-service/phase-28-packaging]]
29. [[plans/01-notification-service/phase-29-ci]]
30. [[plans/01-notification-service/phase-30-release]]

## Required integration work

- [[plans/01-notification-service/http-packet]] repeats per named operation; it is mandatory implementation work, not deferred follow-up. Integrate adapters alongside capabilities, not in a final bulk wiring phase.
- [[plans/01-notification-service/workspace-relocation]] is mandatory phase-01 work. Move the existing app, migrate aliases/configuration/output paths, and update root command delegation before proceeding; do not retain a second root Nitro application.
- Capability dependencies determine order: RLS/authorization before tenant mutations; encryption, credential binding and registration-time egress checks before endpoints; queue/events/admission before public submission; provider adapters before delivery consumers are enabled; lifecycle gates before deletion is exposed.
- Independent APNs/FCM/Web Push adapters may be built in parallel once credential/payload/attempt interfaces are settled; one owner integrates worker dispatch. Do not parallelize edits to shared schemas or the delivery state machine.
- A core internal runtime may use a controlled protocol fixture for verification, but shipped clients never receive a fake-provider fallback. Each provider is qualified before release.
