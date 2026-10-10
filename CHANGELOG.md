# Changelog

## v0.0.6

[compare changes](https://github.com/xcvzmoon/pipong/compare/v0.0.5...v0.0.6)

### 🚀 Enhancements

- **admission:** Reserve tenant request and delivery budgets ([544cce2](https://github.com/xcvzmoon/pipong/commit/544cce2))
- **queue:** Cap provider claims across worker replicas ([e289336](https://github.com/xcvzmoon/pipong/commit/e289336))
- **database:** Persist immutable notification acceptance snapshots ([4e3bf97](https://github.com/xcvzmoon/pipong/commit/4e3bf97))
- **service:** Accept notifications atomically with idempotent replay ([512675c](https://github.com/xcvzmoon/pipong/commit/512675c))
- **api:** Expose authorized notification submission with admission ([3021a7d](https://github.com/xcvzmoon/pipong/commit/3021a7d))
- **database:** Persist and settle fenced delivery attempts ([c3c6a2b](https://github.com/xcvzmoon/pipong/commit/c3c6a2b))
- **service:** Expose fenced delivery execution for workers ([d847403](https://github.com/xcvzmoon/pipong/commit/d847403))
- **delivery:** Persist provider receipts during fenced settlement ([f70514b](https://github.com/xcvzmoon/pipong/commit/f70514b))
- **apns:** Send bound HTTP/2 pushes with fenced settlement ([99facb7](https://github.com/xcvzmoon/pipong/commit/99facb7))
- **fcm:** Add credential-scoped OAuth refresh client ([fea81cc](https://github.com/xcvzmoon/pipong/commit/fea81cc))
- **fcm:** Send and settle fenced HTTP v1 deliveries ([8f8c2ad](https://github.com/xcvzmoon/pipong/commit/8f8c2ad))
- **web-push:** Send and settle version-bound deliveries ([9d4d5ff](https://github.com/xcvzmoon/pipong/commit/9d4d5ff))
- **delivery:** Bound retries and close recovered attempt history ([e877f04](https://github.com/xcvzmoon/pipong/commit/e877f04))
- **database:** Persist immutable delivery redrive audits ([a7f1bfb](https://github.com/xcvzmoon/pipong/commit/a7f1bfb))
- **notifications:** Cancel pending deliveries atomically ([149bf04](https://github.com/xcvzmoon/pipong/commit/149bf04))
- **deliveries:** Redrive terminal work with audited lineage ([8dd4eca](https://github.com/xcvzmoon/pipong/commit/8dd4eca))
- **worker:** Reconcile exhausted delivery recovery jobs ([9facdc0](https://github.com/xcvzmoon/pipong/commit/9facdc0))
- **database:** Allow tenant-scoped API reads of delivery attempts ([7b6d0a9](https://github.com/xcvzmoon/pipong/commit/7b6d0a9))
- **observation:** Expose notification summaries and delivery outcomes ([b4b0d3e](https://github.com/xcvzmoon/pipong/commit/b4b0d3e))
- **events:** Stream durable delivery updates with bounded readers ([3a98d43](https://github.com/xcvzmoon/pipong/commit/3a98d43))
- **database:** Persist scoped erasure jobs and resumable cleanup ([ff98211](https://github.com/xcvzmoon/pipong/commit/ff98211))
- **retention:** Prune expired payloads and audit records in bounded batches ([42b19bc](https://github.com/xcvzmoon/pipong/commit/42b19bc))
- **erasure:** Expose authorized deletion and run resumable worker cleanup ([b81b90e](https://github.com/xcvzmoon/pipong/commit/b81b90e))
- **database:** Persist operator observability state ([72f2d74](https://github.com/xcvzmoon/pipong/commit/72f2d74))
- **service:** Audit privileged human transactions ([b7d61bb](https://github.com/xcvzmoon/pipong/commit/b7d61bb))
- **service:** Expose bounded OpenTelemetry diagnostics ([4960873](https://github.com/xcvzmoon/pipong/commit/4960873))
- **delivery:** Log committed attempt correlations ([5fd6303](https://github.com/xcvzmoon/pipong/commit/5fd6303))
- **worker:** Maintain independent consumer health leases ([1a6fae6](https://github.com/xcvzmoon/pipong/commit/1a6fae6))
- **server:** Add protected operator health and metrics ([7288ab6](https://github.com/xcvzmoon/pipong/commit/7288ab6))
- **deploy:** Package self-hosted runtime images ([fc73995](https://github.com/xcvzmoon/pipong/commit/fc73995))
- **deploy:** Add versioned Compose installation ([42f4961](https://github.com/xcvzmoon/pipong/commit/42f4961))
- **release:** Publish versioned Docker images ([7e74c59](https://github.com/xcvzmoon/pipong/commit/7e74c59))

### 🩹 Fixes

- **tests:** Skip cleanup for signal-terminated processes ([f5d3543](https://github.com/xcvzmoon/pipong/commit/f5d3543))
- **events:** Bound SQL and lock waits for authorized reads ([cec3549](https://github.com/xcvzmoon/pipong/commit/cec3549))
- **auth:** Serialize invitation writes with organization lifecycle ([97817ed](https://github.com/xcvzmoon/pipong/commit/97817ed))
- **delivery:** Reject expired reservation snapshots before provider sends ([d57ae03](https://github.com/xcvzmoon/pipong/commit/d57ae03))
- **database:** Redact SQL and parameters from query logs ([7936321](https://github.com/xcvzmoon/pipong/commit/7936321))
- **format:** Exclude generated changelog ([bac6030](https://github.com/xcvzmoon/pipong/commit/bac6030))
- **ci:** Use string keys for PostgreSQL service ports ([ed5e8b1](https://github.com/xcvzmoon/pipong/commit/ed5e8b1))
- **ci:** Install PostgreSQL 18 restore tools for server tests ([2e558bd](https://github.com/xcvzmoon/pipong/commit/2e558bd))

### 💅 Refactors

- **queue:** Own delivery payload validation in database package ([32ea69c](https://github.com/xcvzmoon/pipong/commit/32ea69c))

### 📖 Documentation

- **admission:** Document capacity accounting and operator limits ([928d324](https://github.com/xcvzmoon/pipong/commit/928d324))
- **plan:** Record phase 18 verification and submission next step ([cdc072f](https://github.com/xcvzmoon/pipong/commit/cdc072f))
- **submission:** Describe acceptance and seven-day replay ([e088549](https://github.com/xcvzmoon/pipong/commit/e088549))
- **plan:** Record phase 19 verification and fenced attempts next ([81c03ab](https://github.com/xcvzmoon/pipong/commit/81c03ab))
- **delivery:** Explain reservation and settlement guarantees ([7d46f19](https://github.com/xcvzmoon/pipong/commit/7d46f19))
- **plan:** Record phase 19 merge ([0d728f7](https://github.com/xcvzmoon/pipong/commit/0d728f7))
- **plan:** Record phase 20 verification and APNs next ([1c25e71](https://github.com/xcvzmoon/pipong/commit/1c25e71))
- **apns:** Explain transport limits and provider qualification ([9797995](https://github.com/xcvzmoon/pipong/commit/9797995))
- **plan:** Record APNs verification and FCM next ([0bc9a02](https://github.com/xcvzmoon/pipong/commit/0bc9a02))
- **fcm:** Document delivery behavior and qualification gates ([f5d7973](https://github.com/xcvzmoon/pipong/commit/f5d7973))
- **plan:** Record audited FCM phase completion ([de0d584](https://github.com/xcvzmoon/pipong/commit/de0d584))
- **web-push:** Describe delivery and browser qualification ([fbea844](https://github.com/xcvzmoon/pipong/commit/fbea844))
- **plan:** Record Web Push verification and next phase ([f52c546](https://github.com/xcvzmoon/pipong/commit/f52c546))
- **recovery:** Describe cancellation, redrive, and retry operations ([1223840](https://github.com/xcvzmoon/pipong/commit/1223840))
- **plan:** Record recovery verification and next phase ([6bfafcd](https://github.com/xcvzmoon/pipong/commit/6bfafcd))
- **observation:** Explain status counts and redacted outcomes ([5f845e5](https://github.com/xcvzmoon/pipong/commit/5f845e5))
- **events:** Describe streaming replay and connection lifecycle ([97a8e88](https://github.com/xcvzmoon/pipong/commit/97a8e88))
- **plan:** Record observation audit and phase 26 handoff ([e85009c](https://github.com/xcvzmoon/pipong/commit/e85009c))
- **erasure:** Document cleanup progress and retained data ([62d1a22](https://github.com/xcvzmoon/pipong/commit/62d1a22))
- **projects:** Describe asynchronous scope deletion ([9718e63](https://github.com/xcvzmoon/pipong/commit/9718e63))
- **recipients:** Explain identity erasure and reenrollment ([6711a58](https://github.com/xcvzmoon/pipong/commit/6711a58))
- **auth:** Describe erasure grant revocation and account retention ([d8befbd](https://github.com/xcvzmoon/pipong/commit/d8befbd))
- **events:** Describe bounded worker replay retention ([2dc5470](https://github.com/xcvzmoon/pipong/commit/2dc5470))
- **plan:** Record phase 26 verification and observability handoff ([a52198b](https://github.com/xcvzmoon/pipong/commit/a52198b))
- **observability:** Document operator diagnostics and alerts ([c9de47c](https://github.com/xcvzmoon/pipong/commit/c9de47c))
- **erasure:** Describe privileged audit retention ([9beb473](https://github.com/xcvzmoon/pipong/commit/9beb473))
- **plan:** Record phase 27 verification and installation handoff ([f1e6aaf](https://github.com/xcvzmoon/pipong/commit/f1e6aaf))
- **deploy:** Document self-hosted installation ([59560ff](https://github.com/xcvzmoon/pipong/commit/59560ff))
- **plan:** Record phase 28 installation evidence ([f610f56](https://github.com/xcvzmoon/pipong/commit/f610f56))
- **ci:** Explain integration and image verification gates ([ef08048](https://github.com/xcvzmoon/pipong/commit/ef08048))
- **plan:** Record phase 29 verification evidence ([8a470eb](https://github.com/xcvzmoon/pipong/commit/8a470eb))
- **ci:** Describe parallel integration gate isolation ([312cc58](https://github.com/xcvzmoon/pipong/commit/312cc58))
- **operations:** Document restore and credential incident procedures ([e0507b5](https://github.com/xcvzmoon/pipong/commit/e0507b5))
- **release:** Distinguish exercised evidence from open qualification gates ([554afe7](https://github.com/xcvzmoon/pipong/commit/554afe7))
- **plan:** Record partial phase 30 qualification ([0126691](https://github.com/xcvzmoon/pipong/commit/0126691))
- **operations:** Explain runtime and image recovery drills ([2e00341](https://github.com/xcvzmoon/pipong/commit/2e00341))
- **release:** Record measured recovery evidence and open gates ([4742822](https://github.com/xcvzmoon/pipong/commit/4742822))
- **plan:** Record partial runtime recovery qualification ([14ff4ae](https://github.com/xcvzmoon/pipong/commit/14ff4ae))

### 🏡 Chore

- **branch:** Sync observability with main ([afa32ae](https://github.com/xcvzmoon/pipong/commit/afa32ae))
- **skills:** Vendor genbumppush release guidance ([1e3b042](https://github.com/xcvzmoon/pipong/commit/1e3b042))

### ✅ Tests

- **apns:** Parameterize retry hint cases to remove lint warning ([9ce71a0](https://github.com/xcvzmoon/pipong/commit/9ce71a0))
- **server:** Fail empty test selections ([a730226](https://github.com/xcvzmoon/pipong/commit/a730226))
- **database:** Preserve tenant data through schema upgrades ([f234cbf](https://github.com/xcvzmoon/pipong/commit/f234cbf))
- **service:** Rehearse database and credential key restoration ([5206a78](https://github.com/xcvzmoon/pipong/commit/5206a78))
- **server:** Rehearse API and worker backup recovery ([d46500c](https://github.com/xcvzmoon/pipong/commit/d46500c))
- **ci:** Rehearse clean-volume image restoration ([54866f5](https://github.com/xcvzmoon/pipong/commit/54866f5))

### 🤖 CI

- Require PostgreSQL-backed integration gates ([c90b0e2](https://github.com/xcvzmoon/pipong/commit/c90b0e2))
- Verify versioned images in a TLS installation ([9060eb4](https://github.com/xcvzmoon/pipong/commit/9060eb4))
- **release:** Publish images only after integration verification ([0b4be8f](https://github.com/xcvzmoon/pipong/commit/0b4be8f))
- Run integration suites with isolated PostgreSQL services ([ae0ac42](https://github.com/xcvzmoon/pipong/commit/ae0ac42))
- Install PostgreSQL 18 tools for restore qualification ([952f1d3](https://github.com/xcvzmoon/pipong/commit/952f1d3))

### ❤️ Contributors

- Mon Albert Gamil ([@xcvzmoon](https://github.com/xcvzmoon))

## v0.0.5

[compare changes](https://github.com/xcvzmoon/pipong/compare/v0.0.4...v0.0.5)

### 🚀 Enhancements

- **database:** Persist environment-scoped recipient identities ([b9b6f73](https://github.com/xcvzmoon/pipong/commit/b9b6f73))
- **service:** Add scoped recipient identity operations ([0b8fc81](https://github.com/xcvzmoon/pipong/commit/0b8fc81))
- **server:** Expose the scoped recipient HTTP lifecycle ([3905c8c](https://github.com/xcvzmoon/pipong/commit/3905c8c))
- **config:** Require absolute credential keyring paths ([93eb8ef](https://github.com/xcvzmoon/pipong/commit/93eb8ef))
- **service:** Encrypt secrets with authenticated tenant context ([837ecf5](https://github.com/xcvzmoon/pipong/commit/837ecf5))
- **database:** Persist scoped immutable credential versions ([217ec6a](https://github.com/xcvzmoon/pipong/commit/217ec6a))
- **service:** Manage encrypted provider credential lifecycles ([08c0655](https://github.com/xcvzmoon/pipong/commit/08c0655))
- **server:** Expose scoped credential lifecycle HTTP operations ([fce8ce6](https://github.com/xcvzmoon/pipong/commit/fce8ce6))
- **service:** Guard Web Push HTTPS connections ([b24a14d](https://github.com/xcvzmoon/pipong/commit/b24a14d))
- **database:** Persist encrypted endpoint generations ([72d73e8](https://github.com/xcvzmoon/pipong/commit/72d73e8))
- **service:** Expose generation-checked endpoint operations ([0c8144c](https://github.com/xcvzmoon/pipong/commit/0c8144c))
- **notifications:** Validate requests and encode bounded provider payloads ([5888073](https://github.com/xcvzmoon/pipong/commit/5888073))
- **notifications:** Validate requests and encode bounded provider payloads ([ce39d39](https://github.com/xcvzmoon/pipong/commit/ce39d39))
- **queue:** Restrict supervision to worker processes ([e7c5581](https://github.com/xcvzmoon/pipong/commit/e7c5581))
- **database:** Provision provider delivery queues ([3ad3806](https://github.com/xcvzmoon/pipong/commit/3ad3806))
- **delivery:** Add transactional queue operations ([9859cc7](https://github.com/xcvzmoon/pipong/commit/9859cc7))
- **worker:** Require provisioned delivery queues at startup ([5cc02d9](https://github.com/xcvzmoon/pipong/commit/5cc02d9))
- **events:** Add commit-ordered delivery ledger ([90f5339](https://github.com/xcvzmoon/pipong/commit/90f5339))
- **api:** Expose authorized delivery event replay ([99d1e88](https://github.com/xcvzmoon/pipong/commit/99d1e88))

### 📖 Documentation

- **recipients:** Document identity and deletion operations ([84ac756](https://github.com/xcvzmoon/pipong/commit/84ac756))
- **plan:** Record recipient phase verification and next steps ([77d3c5d](https://github.com/xcvzmoon/pipong/commit/77d3c5d))
- **credentials:** Document provider versions and key rotation ([7c844cf](https://github.com/xcvzmoon/pipong/commit/7c844cf))
- **plan:** Record credential verification and next steps ([44804d3](https://github.com/xcvzmoon/pipong/commit/44804d3))
- **agents:** Record spacing and worktree preferences ([0678c68](https://github.com/xcvzmoon/pipong/commit/0678c68))
- **egress:** Explain operator destination policy ([3be4cb3](https://github.com/xcvzmoon/pipong/commit/3be4cb3))
- **plan:** Record phase 13 verification and next step ([b94c38f](https://github.com/xcvzmoon/pipong/commit/b94c38f))
- **endpoints:** Describe registration and disable contracts ([a2bca16](https://github.com/xcvzmoon/pipong/commit/a2bca16))
- **plan:** Record phase 14 verification and next step ([1cc760a](https://github.com/xcvzmoon/pipong/commit/1cc760a))
- **notifications:** Describe request fields and provider limits ([1370745](https://github.com/xcvzmoon/pipong/commit/1370745))
- **plan:** Record phase 15 verification and queue next step ([b76ebf8](https://github.com/xcvzmoon/pipong/commit/b76ebf8))
- **notifications:** Describe request fields and provider limits ([d291753](https://github.com/xcvzmoon/pipong/commit/d291753))
- **plan:** Record phase 15 verification and queue next step ([859310b](https://github.com/xcvzmoon/pipong/commit/859310b))
- **queue:** Describe delivery queue operations ([9c37462](https://github.com/xcvzmoon/pipong/commit/9c37462))
- **plan:** Record phase 16 verification and events next step ([f7857d2](https://github.com/xcvzmoon/pipong/commit/f7857d2))
- **events:** Describe replay and retention operations ([c309012](https://github.com/xcvzmoon/pipong/commit/c309012))
- **plan:** Record phase 17 verification and admission next step ([db815c9](https://github.com/xcvzmoon/pipong/commit/db815c9))

### 🏡 Chore

- **skills:** Add create-pr-with-evidence-skill ([139a46b](https://github.com/xcvzmoon/pipong/commit/139a46b))

### ❤️ Contributors

- Mon Albert Gamil ([@xcvzmoon](https://github.com/xcvzmoon))

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
