# Changelog

## v0.0.4

[compare changes](https://github.com/xcvzmoon/pipong/compare/v0.0.3...v0.0.4)

### 🚀 Enhancements

- **auth:** Persist organization disablement ([575657f](https://github.com/xcvzmoon/pipong/commit/575657f))
- **database:** Bind service keys to environment grants ([a41f26c](https://github.com/xcvzmoon/pipong/commit/a41f26c))
- **database:** Expose locked authorization reads ([9c37d00](https://github.com/xcvzmoon/pipong/commit/9c37d00))
- **auth:** Authorize scoped domain operations ([f69728b](https://github.com/xcvzmoon/pipong/commit/f69728b))
- **database:** Enforce scoped resource lifecycle invariants ([5f7db8e](https://github.com/xcvzmoon/pipong/commit/5f7db8e))
- **database:** Expose scoped project operations ([4c43a51](https://github.com/xcvzmoon/pipong/commit/4c43a51))
- **database:** Expose project-owned environment operations ([6839223](https://github.com/xcvzmoon/pipong/commit/6839223))
- **api:** Expose scoped project and environment lifecycle ([9cf35cb](https://github.com/xcvzmoon/pipong/commit/9cf35cb))
- **database:** Enforce immutable service-key lifecycle records ([d0a3fab](https://github.com/xcvzmoon/pipong/commit/d0a3fab))
- **database:** Add scoped service-key lifecycle repositories ([f55ce0f](https://github.com/xcvzmoon/pipong/commit/f55ce0f))
- **auth:** Issue organization keys within tenant transactions ([8007ac9](https://github.com/xcvzmoon/pipong/commit/8007ac9))
- **service:** Bind resource cursors to environment scopes ([deb977c](https://github.com/xcvzmoon/pipong/commit/deb977c))
- **service:** Implement organization service-key lifecycle policy ([e3813ac](https://github.com/xcvzmoon/pipong/commit/e3813ac))
- **server:** Expose the scoped service-key HTTP lifecycle ([2e5618b](https://github.com/xcvzmoon/pipong/commit/2e5618b))

### 🩹 Fixes

- **server:** Generate UUIDv7 request IDs ([dece410](https://github.com/xcvzmoon/pipong/commit/dece410))
- **server:** Resolve the source alias from the app config ([ad08cc4](https://github.com/xcvzmoon/pipong/commit/ad08cc4))

### 📖 Documentation

- **auth:** Explain the domain authorization boundary ([a1a2783](https://github.com/xcvzmoon/pipong/commit/a1a2783))
- **plan:** Record domain authorization completion ([db71443](https://github.com/xcvzmoon/pipong/commit/db71443))
- **api:** Document scoped resource lifecycle operations ([a03bc81](https://github.com/xcvzmoon/pipong/commit/a03bc81))
- **plan:** Record project ownership completion ([5d0da79](https://github.com/xcvzmoon/pipong/commit/5d0da79))
- **shared:** Document configuration parsing contracts ([fe56edd](https://github.com/xcvzmoon/pipong/commit/fe56edd))
- **shared:** Document environment boolean parsing ([c1e4907](https://github.com/xcvzmoon/pipong/commit/c1e4907))
- **database:** Document authentication client ownership ([d1ccf88](https://github.com/xcvzmoon/pipong/commit/d1ccf88))
- **database:** Document MFA assurance persistence ([9a129a8](https://github.com/xcvzmoon/pipong/commit/9a129a8))
- **database:** Document serialized enrollment persistence ([a59639e](https://github.com/xcvzmoon/pipong/commit/a59639e))
- **database:** Document live authority query contracts ([a94410e](https://github.com/xcvzmoon/pipong/commit/a94410e))
- **database:** Document tenant transaction boundaries ([33e826b](https://github.com/xcvzmoon/pipong/commit/33e826b))
- **database:** Document project query contracts ([1bd93ba](https://github.com/xcvzmoon/pipong/commit/1bd93ba))
- **database:** Document environment query contracts ([91e98e4](https://github.com/xcvzmoon/pipong/commit/91e98e4))
- **database:** Document scoped name conflict detection ([f5a8d79](https://github.com/xcvzmoon/pipong/commit/f5a8d79))
- **database:** Document UUID column defaults ([f567fd4](https://github.com/xcvzmoon/pipong/commit/f567fd4))
- **database:** Document timestamp and audit column builders ([648c6ca](https://github.com/xcvzmoon/pipong/commit/648c6ca))
- **database:** Add production URL validation example ([0c1bd22](https://github.com/xcvzmoon/pipong/commit/0c1bd22))
- **database:** Document queue lifecycle and transaction adapter ([110331c](https://github.com/xcvzmoon/pipong/commit/110331c))
- **service:** Document resource validation and pagination ([9a0047c](https://github.com/xcvzmoon/pipong/commit/9a0047c))
- **service:** Document project operation results ([9f3a9ff](https://github.com/xcvzmoon/pipong/commit/9f3a9ff))
- **service:** Document environment operation results ([85b08de](https://github.com/xcvzmoon/pipong/commit/85b08de))
- **service:** Document authorized transaction contract ([9cafed2](https://github.com/xcvzmoon/pipong/commit/9cafed2))
- **auth:** Document authentication engine configuration ([d57dec5](https://github.com/xcvzmoon/pipong/commit/d57dec5))
- **auth:** Document principal authentication failures ([5293ec3](https://github.com/xcvzmoon/pipong/commit/5293ec3))
- **auth:** Document public request handling policy ([1c2266d](https://github.com/xcvzmoon/pipong/commit/1c2266d))
- **auth:** Document enrollment assurance hooks ([8390120](https://github.com/xcvzmoon/pipong/commit/8390120))
- **auth:** Document operator enrollment contract ([923426a](https://github.com/xcvzmoon/pipong/commit/923426a))
- **auth:** Document SMTP configuration requirements ([e907e82](https://github.com/xcvzmoon/pipong/commit/e907e82))
- **auth:** Document email worker cleanup and failures ([6da52e3](https://github.com/xcvzmoon/pipong/commit/6da52e3))
- **agents:** Require JSDoc for shared workspace functions ([836158d](https://github.com/xcvzmoon/pipong/commit/836158d))
- **service-keys:** Document key issuance and rotation operations ([5fde1fb](https://github.com/xcvzmoon/pipong/commit/5fde1fb))
- **plan:** Record completed service-key phase verification ([5512c31](https://github.com/xcvzmoon/pipong/commit/5512c31))

### 🎨 Styles

- **workspace:** Separate dependency catalog groups ([6b36a24](https://github.com/xcvzmoon/pipong/commit/6b36a24))
- **workspace:** Alphabetize dependency catalog groups ([28974bc](https://github.com/xcvzmoon/pipong/commit/28974bc))
- **worker:** Remove shutdown loop comment ([d9517bd](https://github.com/xcvzmoon/pipong/commit/d9517bd))
- **tests:** Remove server startup probe comment ([5e8000f](https://github.com/xcvzmoon/pipong/commit/5e8000f))

### ❤️ Contributors

- Mon Albert Gamil ([@xcvzmoon](https://github.com/xcvzmoon))

## v0.0.3

[compare changes](https://github.com/xcvzmoon/pipong/compare/v0.0.2...v0.0.3)

### 🚀 Enhancements

- **auth:** Persist MFA assurance and append-only enrollment audits ([a43c778](https://github.com/xcvzmoon/pipong/commit/a43c778))
- **auth:** Bootstrap and provision accounts atomically ([fb0fc6a](https://github.com/xcvzmoon/pipong/commit/fb0fc6a))
- **worker:** Add stdin-only operator enrollment command ([149fe09](https://github.com/xcvzmoon/pipong/commit/149fe09))
- **auth:** Guard invitations and MFA recovery with recent assurance ([53fcd76](https://github.com/xcvzmoon/pipong/commit/53fcd76))
- **database:** Enforce project and environment ownership ([53f47ec](https://github.com/xcvzmoon/pipong/commit/53f47ec))
- **database:** Scope tenant work to isolated transactions ([588842a](https://github.com/xcvzmoon/pipong/commit/588842a))

### 💅 Refactors

- **auth:** Share auth configuration with transactional enrollment ([dc59c1b](https://github.com/xcvzmoon/pipong/commit/dc59c1b))
- **database:** Own auth schemas and typed clients ([80f4811](https://github.com/xcvzmoon/pipong/commit/80f4811))
- **database:** Own auth migrations and migration tooling ([203a1fa](https://github.com/xcvzmoon/pipong/commit/203a1fa))
- **database:** Own queue startup and pool integration ([df76498](https://github.com/xcvzmoon/pipong/commit/df76498))
- **database:** Isolate enrollment queries and transactions ([691f4c7](https://github.com/xcvzmoon/pipong/commit/691f4c7))
- **database:** Isolate MFA assurance and audit persistence ([f13ef21](https://github.com/xcvzmoon/pipong/commit/f13ef21))
- **database:** Rename SQL tables to plural names ([1d51539](https://github.com/xcvzmoon/pipong/commit/1d51539))
- **database:** Pluralize table declarations and schema keys ([fb9305c](https://github.com/xcvzmoon/pipong/commit/fb9305c))

### 📖 Documentation

- **auth:** Document local enrollment and audited MFA recovery ([5443c9f](https://github.com/xcvzmoon/pipong/commit/5443c9f))
- **plan:** Complete enrollment phase and advance tenant isolation ([a69cb34](https://github.com/xcvzmoon/pipong/commit/a69cb34))
- **auth:** Describe database-owned auth persistence ([80a5e15](https://github.com/xcvzmoon/pipong/commit/80a5e15))
- **config:** Document centralized migration commands ([60b890f](https://github.com/xcvzmoon/pipong/commit/60b890f))
- **database:** Document persistence APIs and ownership ([9e76035](https://github.com/xcvzmoon/pipong/commit/9e76035))
- **plan:** Correct database ownership and naming rules ([b05518c](https://github.com/xcvzmoon/pipong/commit/b05518c))
- **plan:** Align auth persistence with database ownership ([42c58c4](https://github.com/xcvzmoon/pipong/commit/42c58c4))
- **plan:** Align enrollment persistence ownership ([737d4c3](https://github.com/xcvzmoon/pipong/commit/737d4c3))
- **agents:** Require plural schema table declarations ([76a2526](https://github.com/xcvzmoon/pipong/commit/76a2526))
- **agents:** Require smaller focused commits ([b757ecc](https://github.com/xcvzmoon/pipong/commit/b757ecc))
- **agents:** Define atomic commit staging and review rules ([91b2ac7](https://github.com/xcvzmoon/pipong/commit/91b2ac7))
- **database:** Document tenant transaction usage ([e16d36b](https://github.com/xcvzmoon/pipong/commit/e16d36b))
- **plan:** Record tenant boundary completion ([5cae9bf](https://github.com/xcvzmoon/pipong/commit/5cae9bf))

### 🏡 Chore

- **scripts:** Add worker package command shortcut ([1b8b3f4](https://github.com/xcvzmoon/pipong/commit/1b8b3f4))
- **auth:** Write generated schema references in database ([d8c962d](https://github.com/xcvzmoon/pipong/commit/d8c962d))
- **auth:** Remove database driver and migration dependencies ([d9f9dbb](https://github.com/xcvzmoon/pipong/commit/d9f9dbb))
- **lint:** Keep database drivers out of auth ([f554ec8](https://github.com/xcvzmoon/pipong/commit/f554ec8))
- **lint:** Keep auth policy out of database ([b09e373](https://github.com/xcvzmoon/pipong/commit/b09e373))
- **database:** Include tenant schemas in studio ([3b823f0](https://github.com/xcvzmoon/pipong/commit/3b823f0))

### ✅ Tests

- **auth:** Verify operator enrollment and recovery end to end ([2543de3](https://github.com/xcvzmoon/pipong/commit/2543de3))
- **auth:** Resolve async loop lint warnings in integration tests ([8dbefac](https://github.com/xcvzmoon/pipong/commit/8dbefac))
- **database:** Verify MFA audit atomicity and freshness ([26cb26f](https://github.com/xcvzmoon/pipong/commit/26cb26f))

### ❤️ Contributors

- Mon Albert Gamil ([@xcvzmoon](https://github.com/xcvzmoon))

## v0.0.2

[compare changes](https://github.com/xcvzmoon/pipong/compare/v0.0.1...v0.0.2)

### 🚀 Enhancements

- **config:** Validate API and worker settings at startup ([a35d41a](https://github.com/xcvzmoon/pipong/commit/a35d41a))
- **database:** Control PostgreSQL pools and migrations ([5dd2275](https://github.com/xcvzmoon/pipong/commit/5dd2275))
- **database:** Add UUIDv7 and timestamp schema helpers ([7a66b98](https://github.com/xcvzmoon/pipong/commit/7a66b98))
- **auth:** Add isolated Better Auth and queued email delivery ([9b59063](https://github.com/xcvzmoon/pipong/commit/9b59063))

### 🩹 Fixes

- **auth:** Enforce MFA without trusted devices ([5444498](https://github.com/xcvzmoon/pipong/commit/5444498))

### 💅 Refactors

- **database:** Own connections and migration tooling ([501ef6c](https://github.com/xcvzmoon/pipong/commit/501ef6c))

### 📖 Documentation

- **plan:** Use gpt-6-luna for execution ([d5148d3](https://github.com/xcvzmoon/pipong/commit/d5148d3))
- **config:** Document settings and phase 03 completion ([9793687](https://github.com/xcvzmoon/pipong/commit/9793687))
- **database:** Document provisioning and phase 04 completion ([79904e8](https://github.com/xcvzmoon/pipong/commit/79904e8))
- **database:** Explain setup ownership and operations ([78d061c](https://github.com/xcvzmoon/pipong/commit/78d061c))
- **auth:** Document configuration ownership and security audit ([d48ef83](https://github.com/xcvzmoon/pipong/commit/d48ef83))

### 🏡 Chore

- **skills:** Add Better Auth integration guidance ([e6ca2f8](https://github.com/xcvzmoon/pipong/commit/e6ca2f8))

### ✅ Tests

- Move tests into package root directories ([999e757](https://github.com/xcvzmoon/pipong/commit/999e757))

### ❤️ Contributors

- Mon Albert Gamil ([@xcvzmoon](https://github.com/xcvzmoon))

## v0.0.1

### 🚀 Enhancements

- Add a comprehensive plan ([9808939](https://github.com/xcvzmoon/pipong/commit/9808939))
- **shared:** Add boolean environment schema ([76cdf87](https://github.com/xcvzmoon/pipong/commit/76cdf87))
- **database:** Add validated PostgreSQL client and Drizzle tooling ([2a194db](https://github.com/xcvzmoon/pipong/commit/2a194db))
- **worker:** Add independent Node runtime and tsdown build ([59a0d35](https://github.com/xcvzmoon/pipong/commit/59a0d35))

### 🩹 Fixes

- **workspace:** Resolve internal packages before building ([f5a2d30](https://github.com/xcvzmoon/pipong/commit/f5a2d30))

### 💅 Refactors

- **workspace:** Migrate Nitro server and add recursive scripts ([ece77c1](https://github.com/xcvzmoon/pipong/commit/ece77c1))

### 📖 Documentation

- **plan:** Adopt src-based application layout ([2801ff0](https://github.com/xcvzmoon/pipong/commit/2801ff0))
- **plan:** Require workspace checks before the first build ([db0ccde](https://github.com/xcvzmoon/pipong/commit/db0ccde))
- **worker:** Document build and startup commands ([88f626f](https://github.com/xcvzmoon/pipong/commit/88f626f))

### 🏡 Chore

- Initialize repository ([f84618b](https://github.com/xcvzmoon/pipong/commit/f84618b))
- Add formatter and linter ([25c8f07](https://github.com/xcvzmoon/pipong/commit/25c8f07))
- Add changelog generator and version bumper ([639f992](https://github.com/xcvzmoon/pipong/commit/639f992))
- Add community standards ([9ea4ae2](https://github.com/xcvzmoon/pipong/commit/9ea4ae2))
- Set runtime and package manager ([ce6ca68](https://github.com/xcvzmoon/pipong/commit/ce6ca68))
- **github:** Add actions, templates, and workflows ([cfe5689](https://github.com/xcvzmoon/pipong/commit/cfe5689))
- Add anti-slop rules ([2bd9720](https://github.com/xcvzmoon/pipong/commit/2bd9720))
- **agent:** Add rules and skills ([e74af34](https://github.com/xcvzmoon/pipong/commit/e74af34))
- Add test runner ([c571519](https://github.com/xcvzmoon/pipong/commit/c571519))
- Share checkout/setup across checks, tests, and build ([1dcc5b3](https://github.com/xcvzmoon/pipong/commit/1dcc5b3))
- **workspace:** Align CI and docs with workspace commands ([7e2be40](https://github.com/xcvzmoon/pipong/commit/7e2be40))
- **types:** Tighten root TypeScript configuration ([3dbe9d4](https://github.com/xcvzmoon/pipong/commit/3dbe9d4))
- **lint:** Remove readable spacing rule ([12ec625](https://github.com/xcvzmoon/pipong/commit/12ec625))

### 🎨 Styles

- Format and lint files ([858cacc](https://github.com/xcvzmoon/pipong/commit/858cacc))

### ❤️ Contributors

- Mon Albert Gamil <mrgamilmonalbert@gmail.com>
