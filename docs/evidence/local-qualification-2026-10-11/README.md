# Local qualification reports, 2026-10-11

These reports preserve the local workload measurements recorded in
[release evidence](../../release-evidence.md). Backend services and PostgreSQL
shared two CPU cores and 2 GiB RAM with no swap. The Apple M1 host has eight
cores and 8 GiB RAM; its load driver, TLS proxy, and provider fixtures were
outside the backend cap. All runs used 150,000 retained queue-history rows.

The runs were made from base commit `91b666dd00ac6102a7b3f5493c959bd1ffa93803`
with the evolving uncommitted qualification changes. Earlier reports describe
earlier harness revisions, not the final mixed-provider implementation. Exact
intermediate source snapshots and removed image digests were not retained.
Reports contain synthetic fixture IDs and counters, without credentials or
notification payloads. Raw logs remain local under `/tmp`.

| Report                                                        | Duration   | Requests/s | Outcome                                                                         |
| ------------------------------------------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------- |
| [capacity-baseline](capacity-baseline.json)                   | 60 seconds | 50         | Failed sustained acceptance/dispatch latency; all deliveries completed          |
| [capacity-25](capacity-25.json)                               | 60 seconds | 25         | Passed APNs-only workload comparison                                            |
| [local-30m](local-30m.json)                                   | 30 minutes | 25         | Passed APNs-only consumer harness; SSE checked after sustained load             |
| [full-worker-short](full-worker-short.json)                   | 60 seconds | 25         | Passed built full-worker lifecycle with APNs traffic                            |
| [full-worker-30m](full-worker-30m.json)                       | 30 minutes | 25         | Passed built full-worker lifecycle with APNs traffic                            |
| [independent-sse-short](independent-sse-short.json)           | 60 seconds | 25         | Passed APNs traffic with 1,000 sustained streams across forty principals        |
| [independent-sse-30m](independent-sse-30m.json)               | 30 minutes | 25         | Passed APNs traffic with 1,000 sustained streams across forty principals        |
| [mixed-provider-25rps-short](mixed-provider-25rps-short.json) | 60 seconds | 25         | Failed host-path Web Push latency/completion; earlier attempt-counting logic    |
| [mixed-provider-15rps-short](mixed-provider-15rps-short.json) | 60 seconds | 15         | Failed host-path Web Push latency; earlier attempt-counting logic               |
| [mixed-provider-separated](mixed-provider-separated.json)     | 60 seconds | 15         | Failed host-path Web Push latency; six transport aborts, eventual completion    |
| [mixed-provider-linux-short](mixed-provider-linux-short.json) | 60 seconds | 15         | Passed mixed-provider Linux-loopback comparison                                 |
| [mixed-provider-30m](mixed-provider-30m.json)                 | 30 minutes | 15         | Passed mixed-provider Linux-loopback qualification with 1,000 sustained streams |

The shared-listener diagnostic timed out before saving a JSON report. Two
isolated 500-request TLS probes each had zero failures, but did not reproduce
the complete workload. See release evidence for these observations and earlier
capacity-discovery context. The duplicate `mixed-provider-short` report is the
same run as `mixed-provider-25rps-short` and is stored once here.

The final passing workload is 15 requests/s across APNs, FCM, and Web Push.
The separate APNs-only 25-request/s pass does not establish mixed-provider
capacity at that rate. Neither rate is a measured capacity ceiling. Live
provider/device, intended-deployment recovery, and publication remain open.

Lockfile SHA-256 at publication preparation:
`3b396c281057740867573a4d75549b992283089dcd9382fd4431212c629d1c79`.
