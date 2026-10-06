# Changelog

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
