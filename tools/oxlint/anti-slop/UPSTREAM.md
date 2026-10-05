# Anti-slop provenance

- Source repository: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop).
- Exact source commit: [`e6676e8d0bf17c678cb45b9dacb2bd6ca8dea53a`](https://github.com/dmmulroy/anti-slop/tree/e6676e8d0bf17c678cb45b9dacb2bd6ca8dea53a/skills/install-anti-slop/assets/anti-slop).
- Source directory: `skills/install-anti-slop/assets/anti-slop/`, supplied by the local `install-anti-slop` skill.
- Installed directory: `tools/oxlint/anti-slop/`.
- Generic entry point: `tools/oxlint/anti-slop/index.ts`.
- Optional Effect entry point: `tools/oxlint/anti-slop/effect/index.ts` (copied but not enabled; the project has no direct Effect dependency).

## Verification

All 38 bundled files and their installed copies were compared byte-for-byte with the source directory in the exact commit's GitHub tarball. The pristine snapshot SHA-256 is `6a5e9b6e859ea6668a06dd49fc158056c36617d50685a49ac2394ea9ab2be340`, computed over sorted relative file paths, each followed by a NUL byte, its original contents, and another NUL byte. This added provenance record is excluded from that snapshot.

## Intentional deviations and integration

No copied rule, helper, or vendored asset was modified. This provenance record is the only addition to the copied tree. The repository owns the vendored implementation and can maintain intentional changes here.

`oxlint.config.ts` registers the generic plugin and enables all 18 generic rules at error severity alongside the existing native `oxc/no-accumulating-spread` rule. `pnpm-workspace.yaml` pins both `oxlint` and `@oxlint/plugins` to `1.86.0` while retaining the project's catalog dependency references. Agent tooling and the vendored plugin are excluded from linting and formatting in `oxlint.config.ts` and `oxfmt.config.ts`.

The copied Stylistic rule retains its [MIT license](./vendor/eslint-stylistic/LICENSE) and separate [upstream provenance and adaptations](./vendor/eslint-stylistic/UPSTREAM.md). Preserve both when updating or redistributing the plugin.

## Updating

Compare an explicit upstream revision against this recorded source before merging updates. Preserve local rule, diagnostic, and configuration choices, and update this record to identify the actual copied assets. Run `pnpm run check` and verify the configured plugin through the Oxlint CLI after updating.
