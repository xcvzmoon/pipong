# Todos

<!-- next-id: 3 -->

## Product

1. [ ] Implement the scoped self-hosted notification service; phases 01–22 integrated; phases 23–29 implemented locally with PostgreSQL/protocol/HTTP/TLS SSE, clean-image installation, and CI/release gate verification (remote workflow and live provider qualification open); phase 30 includes database/key smoke, built API/worker recovery, clean-volume image recovery, and incident/evidence docs; live providers, active-send/post-snapshot/WAL recovery, 30-minute full-worker local harness passed at 25 requests/s within 2 CPU/2 GiB with 1,000 sustained SSE streams across forty session/key principals, selective revocation, and replay; mixed-provider Linux-loopback 30-minute qualification passed at 15 requests/s with 55,902 deliveries and 1,000 sustained streams; live-provider/device load, deployment recovery, and published-artifact gates remain open [[plans/01-notification-service/overview]]

Completed tasks: [[archive/todos]]
