# Tested compatibility record

Recorded on 2026-10-11 from the installed workspace, lockfile, and local Linux
recovery evidence. These versions describe the tested combination. They do
not imply support for other versions allowed by a dependency range.

- Node.js 24.21.0; pnpm 12.6.0; PostgreSQL 18.6.
- Nitro 3.0.260903-beta; H3 2.0.1; Rolldown 1.2.12.
- Better Auth, API-key plugin, and Drizzle adapter 1.7.7.
- Drizzle ORM and migration tooling 1.0.0-rc.4; node-postgres 8.23.1.
- pg-boss 12.37.0; Valibot 1.5.0.
- Google Auth Library 10.9.1; gaxios 7.3.1; web-push 3.6.7.
- Unemail 0.7.0; Handlebars 4.7.8.
- TypeScript 7.0.2; Vitest 5.0.3.

Local qualification ran on macOS arm64 and Linux arm64 containers. The deployment
target is this Apple M1 host with a Linux backend budget of two CPUs/2 GiB/no
swap. The four-image installation drill used database TLS, separate mounted
secrets, and non-root API/worker/migrator images. Its Compose stack had no
aggregate resource cap.

[Hosted CI for b02aa056](https://github.com/xcvzmoon/pipong/actions/runs/38150980357)
passed on 2026-10-11, including its static, isolated integration, and image
checks. This is baseline CI evidence; the new physical application recovery
fixture has not run in hosted CI.

PostgreSQL physical backups require matching major-version binaries; keep the
database image digest and recovery tooling with the backup record. The Node
server preset is the exercised runtime. Edge/serverless deployments and other
Node/PostgreSQL major versions are outside this evidence.

See [release evidence](release-evidence.md) for measured workloads and remaining
gates, and [publication prerequisites](publication.md) for registry access.
Framework beta compatibility, hosted artifacts, and actual device/browser
versions must be recorded again for the revision that is released.
