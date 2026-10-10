# Self-hosted installation

This installation packages the Node 24 API, worker, local enrollment operator,
and a one-shot Drizzle migration job. PostgreSQL 18 is the only required database.
Push delivery defaults to disabled pending release qualification. Submission,
status, SSE, authentication mail, and maintenance are available. To exercise push
delivery, set `PUSH_DELIVERY_ENABLED=true` and `WEB_PUSH_SUBJECT` in `worker.env`.
Full readiness returns 503 when required consumer leases are missing. See [release gates](brain/plans/01-notification-service/phase-30-release.md).

## Prepare secrets

Use Docker Compose v2 and a TLS reverse proxy on the host. Keep deployment secrets
outside the checkout and set `PIPONG_SECRETS_DIR` to their absolute directory path.
Compose mounts individual files read-only. Local Compose secrets are bind mounts,
not an encrypted secret store. Limit directory access to operators. App files
must be readable by container UID 1000; on Linux, use owner UID 1000 and mode 0400.
Database password files and `database.crt` must be readable by container postgres
UID 999. The CA certificate must be readable by UID 1000. The database private key
is read by root and copied into a postgres-owned mode-0600 file at startup.

Create these files through your secret manager:

| File                      | Contents                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `admin-password`          | PostgreSQL administrator password                                                           |
| `api-password`            | `pipong_api` password                                                                       |
| `worker-password`         | `pipong_worker` password                                                                    |
| `migrator-password`       | `pipong_migrator` password                                                                  |
| `database.crt`            | PEM server certificate with DNS SAN `database`                                              |
| `database.key`            | PEM server private key                                                                      |
| `database-ca.crt`         | PEM certificate authority that issued the server certificate                                |
| `diagnostics-token`       | Random 32–256 character monitoring token, as described in [observability](OBSERVABILITY.md) |
| `credential-keyring.json` | Shared encryption keyring, as described in [credentials](CREDENTIALS.md#encryption-keyring) |
| `api.env`                 | API runtime variables below                                                                 |
| `worker.env`              | Worker runtime variables below                                                              |
| `migration.env`           | Migration variable below                                                                    |

Use independent random passwords. Percent-encode password characters in connection
URLs. Do not include secrets in Docker build arguments or the Compose file.
Database passwords are applied during first initialization only. Rotate existing
role passwords with an administrator connection and replace the corresponding
runtime secret files.

`api.env`:

```dotenv
AUTH_BASE_URL=https://notifications.example.com
AUTH_SECRET=<at least 32 random characters>
DIAGNOSTICS_TOKEN_REF=/run/secrets/diagnostics-token
API_DATABASE_URL=postgres://pipong_api:<encoded password>@database:5432/pipong?sslmode=verify-full&sslrootcert=/run/secrets/database-ca
CREDENTIAL_KEYRING_REF=/run/secrets/credential-keyring.json
```

`worker.env`:

```dotenv
WORKER_DATABASE_URL=postgres://pipong_worker:<encoded password>@database:5432/pipong?sslmode=verify-full&sslrootcert=/run/secrets/database-ca
CREDENTIAL_KEYRING_REF=/run/secrets/credential-keyring.json
AUTH_MAIL_FROM=auth@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USER=<login>
SMTP_PASSWORD=<password>
APNS_ENVIRONMENT=production
```

`migration.env`:

```dotenv
MIGRATION_DATABASE_URL=postgres://pipong_migrator:<encoded password>@database:5432/pipong?sslmode=verify-full&sslrootcert=/run/secrets/database-ca
```

Node loads dotenv files directly. See [configuration](CONFIGURATION.md) for optional
pool budgets, provider settings, egress policy, and telemetry. To use an operator
egress policy, add its file as a Compose secret on both apps and set
`WEB_PUSH_EGRESS_POLICY_REF` to the mounted absolute path.

## Install

Select one published release version for every service:

```sh
export PIPONG_VERSION=<release version without the leading v>
export PIPONG_SECRETS_DIR=/absolute/operator/secrets
docker compose --profile tools pull
docker compose up -d --wait --no-build database
docker compose run --rm --pull never migrate
docker compose run --rm --pull never -T operator < /absolute/operator/bootstrap.json
docker compose up -d --wait --no-build api worker
```

To install from a checkout instead, set `PIPONG_VERSION` to that checkout's
`package.json` version and run `docker compose build database api worker migrate
operator` before the startup commands. Skip the pull command for local builds.

Run exactly one migration job at a time. A failed job must stop the deployment;
neither app runs migrations on startup. On upgrades, stop traffic and apps before
running migrations unless that release explicitly documents rolling schema
compatibility. Do not grant migration credentials to API or worker containers.

The initial database script creates restricted roles. Migration owns schema DDL;
the API and worker reject unsafe database identities on startup. PostgreSQL is
not published to the host. Its volume survives container replacement. Do not use
`docker compose down --volumes` on an installation whose data you need.

The operator accepts enrollment JSON through stdin. Its image includes the built
operator and shared chunks; it uses only the API secret and database role. See
[bootstrap input and enrollment](AUTHENTICATION.md#local-operator-enrollment).

For an existing external PostgreSQL 18 installation, provision roles using
`packages/database/provision.sql`, replace the database hostname in all three
URLs, and remove the Compose database service and its `depends_on` entries.
Use a server certificate for that hostname and the matching CA secret.

## TLS and SSE proxy

The API listens on host loopback port 3000. Terminate public TLS at your reverse
proxy with a certificate for `AUTH_BASE_URL`. A host nginx HTTPS server can use:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 75s;
}
```

Apply request/body and authentication rate limits at the proxy, as described in
[authentication](AUTHENTICATION.md). Overwrite forwarded headers; the API must
only be reachable through that proxy. Buffering and compression must remain off
for SSE. Verify events arrive individually over public HTTPS, reconnect with the
last cursor, and verify revoked credentials close the stream. See [events](EVENTS.md).

The Compose healthcheck uses liveness so disabled push consumers do not
cause a restart loop. Route production traffic according to protected readiness
once qualified push consumers are enabled. See [observability](OBSERVABILITY.md).

## Drain, restart, and backup

Remove an API replica from proxy rotation before sending SIGTERM. Allow existing
requests and SSE cleanup to finish; clients reconnect and replay durable events.
Compose allows 60 seconds for the API and 90 seconds for the worker. Worker SIGTERM
stops processing and drains the mail queue before closing its database pool.
Unfinished queue jobs remain durable for recovery after restart.

```sh
docker compose stop api worker
docker compose run --rm --pull never migrate
docker compose up -d --wait --no-build api worker
```

For a compatible rolling release, replace one replica at a time and wait for its
readiness before replacing the next. The single-replica Compose example requires
a maintenance window. It does not orchestrate rolling replacement.

Back up PostgreSQL and the credential keyring separately. Restore both into an
isolated environment, rerun the migration job, and verify enrollment, tenant
isolation, submission, and event replay before routing traffic. Retention and
erasure do not remove historical backups; see [erasure](ERASURE.md).

## Artifact boundaries

`server` and `worker` Docker targets run as UID 1000 with read-only roots and no
Linux capabilities in Compose. The API image contains the complete Nitro `.output`
and built operator directory. The worker contains the complete `dist` directory.
Neither needs a mounted checkout. The `migrate` target retains the locked build
toolchain and database source/configuration because Drizzle Kit owns migration
execution. It runs as UID 1000 and exits after applying the three migration sets.

## Release image tags

The tag-triggered release workflow builds and verifies the server, worker,
migration, and database images, then publishes them to
`ghcr.io/xcvzmoon/pipong-{server,worker,migrate,database}`. Each receives both the
SemVer tag (`0.0.6`, for example) and the Git release tag (`v0.0.6`). Compose uses
`PIPONG_VERSION` for every image, including the operator's server image.

From a clean, committed checkout, preview the next version, then release:

```sh
pnpm release --dry-run
pnpm release
```

The release command updates the version and changelog, creates the release commit
and tag, and pushes them. The pushed tag starts CI, which runs the release gates,
builds and verifies the images, publishes them to GHCR, and creates the GitHub
release. Local Docker images and registry credentials are not required to cut a
release.

CI uses `ops/genbumppush.config.ts` for Docker publication and GitHub release
creation. If publication fails, fix the failure and rerun the release workflow for
the same tag. It rebuilds and verifies the images before publishing them again,
without creating another version. `CHANGELOG.md` remains excluded from formatting.
