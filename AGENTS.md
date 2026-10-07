This project is based on [Nitro v3](https://nitro.build), [h3](https://h3.dev/), and [Rolldown](https://rolldown.rs/).

Refer to `node_modules/nitro/dist/docs/README.md` when working on server (your knowledge about Nitro v3 is likely outdated!).

## Project Structure

`server/` contains server-side code with supported subdirs (create as needed): `api/` (/api prefixed handlers), `routes/` (non-prefixed route handlers), `middleware/`, `plugins/`, `utils/`, `assets/`, and `tasks/`. `public/` holds static assets (copied, not bundled). Config files: `nitro.config.ts` (serverDir, routeRules, preset, etc.), `tsconfig.json`.

## Conventions

- Path alias `~/*` (tsconfig), use explicit `.ts` extensions

# AGENT RULES

Run `pnpm install` before the first typecheck.

**Validation:** Run `pnpm check` before calling work done.

Store tests in `tests/` at each app or package root, separate from `src/`.

Do not treat `tools/oxlint/anti-slop/**`, `.agents/**`, or `.codex/**` as something to refactor for product features. oxfmt/oxlint intentionally ignore both.

Genbumppush writes `CHANGELOG.md`. Keep that file out of formatter runs; oxfmt and the pre-commit format job exclude it.

## Style And Type Rules

oxfmt: single quotes; import order is type-imports → builtins/externals → internal → relative.

oxlint is type-aware (`typeAware` / `typeCheck`) and includes the local **anti-slop** plugin. Failures here are common when writing "helpful" generic helpers:

- No `as` / type assertions without a preceding `SAFETY:` comment (const assertions are fine).
- No broad `object` / `unknown` as parameter, return, or type-alias types. Use named types; parse external input at the boundary. (Prefer `unknown` over `any` only for values you will narrow — not as a bare function input type.)
- No `filter().map()` chains — use one loop. No `reduce` that just copies into a new object/array.
- No bag options / object parameters when discrete arguments fit.
- No `Reflect.apply`, `Reflect.get`, runtime `typeof` for type-level decisions, or chained assertions.
- No module mocking in tests (`anti-slop/no-module-mocking`).
- No accumulating array/object spread in loops (`oxc/no-accumulating-spread`).
- `no-console`: only `warn` / `error` / `info`.
- Unused vars/args: prefix with `_`.
- `no-non-null-assertion` is a warning — avoid `!`.

## Code conventions

- Use `import type` for type-only imports (enforced by oxlint's `typescript/consistent-type-imports`)
- **Single quotes**, no semicolons
- **`no-console`**: only `warn`/`error`/`info` allowed
- **`no-non-null-assertion`** is a warning — avoid `!`; type-aware rules also catch most unsafe patterns

## Editing Guidance

- Make the smallest correct change.
- Do not polish unrelated code.
- Preserve accurate JSDoc and required tooling directives; remove ordinary comments when touching code.
- Do not rename broad parts of the codebase unless required.
- Do not expand a change into a repo-wide refactor unless necessary.
- Prefer leaving correct existing code in place.
- When touching production-sensitive code, prioritize reliability over clever abstractions.

## Formatting And Style

- Match the surrounding file's formatting instead of hand-styling custom layouts.
- Prefer `function name()` for named functions and helpers.
- Do not prefer `const fn = () => {}` for normal top-level helpers.
- Exception: callbacks should stay as arrows, for example `items.map((item) => item.id)`.
- If only one or two properties is needed from iterated item and will not conflict other variables, prefer destructuring.
- Prefer functions over classes.
- Existing classes that are already correct can stay; do not rewrite them for style only.
- Keep diffs small and focused.

## JSDoc

- Require JSDoc when adding or changing exported functions shared across workspace apps or packages through package entry points or subpath exports. An `export` used only within its own app or package does not require JSDoc.
- Document internal functions only when callers need an explanation of non-obvious behavior, constraints, or resource ownership.
- Include a clear description, `@param` entries for each parameter, `@returns`, and a practical `@example`. Document optional parameters and defaults accurately.
- Add `@throws` for errors that can reach the caller, including stable error codes where applicable. Describe returned failure results under `@returns` instead of treating them as thrown errors.
- Explain relevant validation requirements, side effects, authorization boundaries, and cleanup responsibilities. Keep existing JSDoc in sync with behavior.
- In TypeScript, rely on the function signature for types rather than repeating them in JSDoc tags. Use fenced TypeScript examples that match the actual API.
- Do not add ordinary line or block comments. Preserve required lint directives and `SAFETY:` comments.
- Apply the `/unslop` skill to JSDoc text.

## Types And Naming

- Prefer `type` over `interface`.
- Avoid `any`; prefer `unknown` and narrow it explicitly but avoid creating isRecord function.
- Add explicit return types to exported functions and non-trivial helpers.
- Use string literal unions for small state enums like `'ok' | 'error'`.
- Keep generics minimal and purposeful.
- Reuse existing helper types before inventing new ones.
- Use descriptive names.
- Always use plural SQL table names and plural table declaration identifiers in every schema, including test fixtures (for example, `users` and `verifications`).
- Do not abbreviate iterable items; prefer `item`, `entry`, `record`, `status`.
- Avoid one-letter names except for conventional indexes.

## Validation, Errors, And Responses

- Use Valibot for environment parsing, form validation, and request validation.
- Prefer `camelCaseSchema` over `PascalCaseSchema` in generating schemas.
- Prefer composable `v.pipe()` schemas with built-in actions and reusable transform helpers instead of manual parsing or ad-hoc validation logic.
- Validate once at the boundary, not repeatedly in inner layers.
- Never throw raw strings.
- Catch infrastructure errors where graceful degradation is expected.
- Clean up temporary resources in `finally` blocks.
- Include stable error codes in config validation and app-level failures.

## Skills

Project skills live in `.agents/skills/` and are tracked in `skills-lock.json`. They are vendored agent instructions, not product code. Use relevant skills when loaded (for example `/unslop`, `/nitro`, `/ts-best-practices`, `/quality`). Do not rewrite skill folders as part of product features.

## Agents

- Commit or push only when explicitly asked. Never add co-author trailers.
- When asked to commit, include all task-related changes and leave unrelated changes alone.
- Split changes into the smallest coherent, independently reviewable commits. Each commit must have one specific purpose; broad categories such as "refactor persistence" or "update docs" are not enough to justify bundling independent changes.
- Separate independent modules and concerns, including SQL table renames, declaration renames, dependency cleanup, lint rules, tests, and documentation. Keep imports, types, call sites, and tests together when they are required for a change to work.
- Stage explicit paths or hunks. If a file contains several independent changes, stage each change separately instead of committing the whole file.
- Review the staged diff before every commit. Split it further if its purpose needs multiple independent actions to describe. Keep each intermediate commit valid.
- Use a one-line Conventional Commit message for each commit. Do not combine changes just to reduce the number of commits.
- When ask to create a Pull Request: use the proper template, run `unslop` skill, assign to me, and add proper labels.
- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.
- If you need a paragraph-long comment to justify why the workaround is OK, the code is wrong so fix the code.
- Always use the unslop skill `/unslop` when generating texts as well as in adding jsdocs/tsdocs or just comments.
