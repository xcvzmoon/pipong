# Server workspace relocation

Back to [[plans/01-notification-service/overview]]

## Decision

- User-selected layout: apps/server/src for Nitro sources, apps/worker/src for delivery processing, packages/service/src for shared code. App manifests/configuration remain at each app root. Repository root contains workspace/tooling configuration, lockfile, integration tests, documentation, and deployment orchestration.
- This is planned migration work, not a statement that these app directories already exist. Complete all packets during phase 01 before the independent worker build.
- Follow [[principles/smallest-complete-design]] and [[principles/prove-boundaries]]: move the existing working starter, preserve its HTTP/static behavior, and remove obsolete root application paths instead of keeping forwarding configs.

## Packet A: server manifest and configuration

- Primary files: apps/server/package.json, apps/server/nitro.config.ts, apps/server/tsconfig.json.
- Give the server a private workspace identity and its own Nitro development/build/preview commands and dependencies. Keep root runtime/package-manager policy authoritative and use workspace dependencies for shared service imports.
- Move the existing Nitro and application TypeScript configuration into apps/server. Set serverDir ./src relative to that app; align Nitro runtime and TypeScript ~/* aliases with apps/server/src, not with unrelated workspace sources. Do not use the deprecated srcDir option.
- Verification: install and resolve the server workspace and inspect effective configuration/type paths. Run the complete HTTP smoke after packet B; no placeholder endpoint is needed between relocation packets.

## Packet B: current source and static assets

- Primary files: apps/server/src/api/index.ts, apps/server/index.html, apps/server/public/styles.css.
- Move the current server/ sources into apps/server/src and landing/static assets into the app root without changing behavior. If additional application files exist at execution time, migrate each in another bounded packet; do not leave competing root app sources or a nested apps/server/server directory.
- Verification: build and launch Nitro from apps/server; request /api, the landing page, and /styles.css. Observe the existing response and asset rendering. Confirm root development/preview commands select this app.

## Packet C: workspace validation and output paths

- Primary files: tsconfig.json, vitest.config.ts, .gitignore. Root package.json script orchestration is covered by phase 01.
- Replace the root application-specific Nitro TypeScript setup with workspace/tooling validation; retain apps/server's Nitro types locally. Ensure pnpm check covers each app/shared package and root tooling rather than checking only the old root app.
- Keep integration tests at root with explicit workspace imports and app startup paths. Ignore app-local generated output, including apps/server/.output; do not move or commit generated artifacts as source.
- Verification: root check/test/build commands cover the intended projects without recursive delegation or accidental root Nitro discovery. Once phase 02 exists, verify the worker is checked/built independently.

## Routing and integration

- Use execute, nitro, pnpm, ts-best-practices, testing, quality, and unslop during implementation. Each packet has at most three primary files; split additional execution-time files into further bounded packets.
- Keep root formatting/lint catalogs and vendored tools in place. Update README/CONTRIBUTING command and path references with the relocation; adjust existing release orchestration paths where necessary without changing release behavior.
- Container and CI paths are required again in phases 28–29: build apps/server, consume apps/server/.output, and build the worker separately. No third deployment or new notification feature is introduced by this layout change.
