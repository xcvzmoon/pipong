# Web Push egress

Phase 13 supplies `loadEgressPolicy`, `validateDestination`, and `sendWebPushRequest` from `@pipong/service`. [Endpoint registration](./ENDPOINTS.md) applies destination checks before storing subscriptions. Provider dispatch is a later phase. No tenant-facing policy mutation route exists.

Load policy from an operator-owned absolute JSON file, or omit the path for defaults. Only deployment code may select the policy file or DNS resolver. Never construct exceptions from subscription input. API registration reads `WEB_PUSH_EGRESS_POLICY_REF` for the operator-owned policy file; omit it for defaults. API registration and worker sends must use the same deployment policy.

Defaults allow public HTTPS destinations on port 443. Every DNS answer must pass screening; mixed public/private answers fail. IPv4-mapped IPv6 is screened as IPv4. Loopback, private, link-local, multicast, reserved, and transition ranges are blocked by default. Each send resolves again and connects to one screened address with the original Host and TLS identity. Connections are not pooled, proxies are not used, and redirects are rejected.

An operator can permit a private push origin with an exact canonical origin (including a non-default port) and explicit CIDRs:

```json
{
  "privateOrigins": [
    {
      "origin": "https://push.internal:8443",
      "cidrs": ["10.20.0.0/24"],
      "ca": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
    }
  ],
  "totalTimeoutMs": 10000,
  "idleTimeoutMs": 5000,
  "maxResponseBytes": 8192
}
```

Private CA trust is optional; normal system trust applies when omitted. TLS certificate and hostname verification always remain enabled. Exceptions apply only to the named origin and matching non-public addresses; they do not permit another private DNS answer. Keep exception CIDRs narrow. An egress firewall provides another enforcement layer.

Generate request details with `web-push.generateRequestDetails` using per-request VAPID credentials and `aes128gcm`, then pass them to `sendWebPushRequest`. The transport performs no retries and returns bounded status, headers, and body for provider classification. It caps response headers at 16 KiB and body at the configured limit. Total time includes DNS, TLS, upload, and response; socket inactivity also has a deadline. A timed-out DNS query may finish in the background but cannot start a connection.

Errors use stable `EGRESS_*` codes and omit endpoint URLs and provider response bodies. Returned bodies and headers remain sensitive: do not log them without redaction. DNS screening does not prove that a public origin belongs to a browser push provider.

Protocol fixtures in `packages/service/tests/` use a local HTTPS server, generated Web Push requests, and trusted resolver functions. Their checked-in key is test-only. Run `pnpm service test` to verify private/mapped/mixed addresses, pinning and re-resolution, redirects, TLS trust and hostname failures, body limits, and DNS/stream deadlines.
