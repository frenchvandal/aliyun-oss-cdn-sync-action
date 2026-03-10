# CLAUDE.md — aliyun-oss-cdn-sync-action

This file aligns with `AGENTS.md`. If instructions conflict, `AGENTS.md` is the
source of truth.

Language policy:

- Repository-facing outputs are English (code, comments, commits, PR titles, and
  repo docs).
- Repository-facing English must be natural, fluent, and aligned with the
  Chicago Manual of Style.
- In repository documentation, use `Aliyun` as the provider name. Do not use
  `Alibaba Cloud`.
- Direct exchanges with the maintainer can remain French unless requested
  otherwise.

## Quick context

- Deno project with a GitHub Action entrypoint in `src/main.ts`.
- `dist/` bundles are committed and executed in GitHub Actions (`node24`).
- OSS uploads and CDN operations are rate-limited via `ApiRateLimiter`.

## Required checks

Before finalizing changes, run:

```bash
DENO_TLS_CA_STORE=system deno task build
```

If Deno is missing:

```bash
curl -fsSL https://deno.land/install.sh | sh
export PATH="$PATH:/root/.deno/bin"
```

## Commit messages

Commit messages are validated on every `git commit` by a pure-Deno linter
(`src/lint-commit.ts`) triggered via a Lefthook `commit-msg` hook.

**Install the hook once after cloning:**

```bash
DENO_TLS_CA_STORE=system deno task hooks:install
```

Follow the [Conventional Commits](https://www.conventionalcommits.org/)
specification:

- Format: `<type>[optional scope][optional !]: <description>`
- Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
  `refactor`, `revert`, `style`, `test`
- Header ≤ 100 characters; no leading/trailing whitespace; no trailing full stop
  on the subject
- Body, when present, must be separated from the header by a blank line
- Breaking changes can be expressed with `!` in the header and/or with a
  `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer

`release-please` compatibility in this repo:

- All allowed commit types above are parsed by `release-please`.
- Default user-facing changelog sections are `feat`, `fix`, `perf`, and
  `revert`; other allowed types are valid but hidden by default.
- Version bump behavior is controlled by `.github/release-please-config.json`.
  If `versioning` is forced (for example `always-bump-minor`), commit types no
  longer drive major/minor/patch selection.

Validate every commit message against the Conventional Commits specification
before pushing. Never use `git commit --no-verify` — the hook must not be
bypassed.

## Guardrails

- Never skip `dist/` regeneration when `src/` changes.
- Keep CDN errors non-fatal.
- Do not bypass rate limiting.
- Prefer feature flags over code removal.
- Avoid unnecessary dependencies and over-engineering.
- Prefer `node:*` built-in imports over Deno native runtime APIs when both are
  viable. GitHub Actions runs the committed bundles on Node.js (`node24`), so
  Node built-ins maximize interoperability.

## Imports and dependencies

- Prefer `node:*` built-ins over Deno native APIs for runtime primitives (`fs`,
  `path`, `os`, `process`, and similar) unless a documented exception requires
  otherwise.
- Import order: (1) Node built-ins (`node:*`) -> (2) external dependencies ->
  (3) local modules.
- Keep one blank line between import groups.
- Use `import type` for type-only imports (required by
  `compilerOptions.verbatimModuleSyntax`).
- External imports must be declared as aliases in `deno.json` `imports` (never
  in `import_map.json`).
- Alias values use `jsr:`, `npm:`, and `node:` schemes.
- Alias keys use `<provider>/<alias-name>` (`jsr/`, `npm/`, `node/`) with a
  concise kebab-case alias name, not a bare package key.
- Examples:
  - `"jsr/assert": "jsr:@std/assert@^1.0.19"`
  - `"jsr/testing-bdd": "jsr:@std/testing@^1.0.17/bdd"`
  - `"npm/faker-js": "npm:@faker-js/faker@^10.3.0"`
  - `"npm/opentelemetry-api": "npm:@opentelemetry/api@^1.9.0"`
  - `"node/path": "node:path"`

### Deno 2.x trailing slash rules (`deno.json#imports`)

1. `jsr/...`, `npm/...`, `node/...` aliases
   - No trailing slash on key or value.
   - Example: `"npm/opentelemetry-api": "npm:@opentelemetry/api@^1.9.0"`.

2. Local directory aliases (prefix mapping)
   - Trailing slash required on both key and value.
   - Example: `"local/components/": "./src/components/"`.

3. Exact local file aliases
   - No trailing slash.
   - Example: `"local/main": "./src/main.ts"`.

4. Legacy HTTP imports
   - Avoid when possible; prefer `jsr:`/`npm:`.
   - If subpaths are needed, define both exact and prefix entries:
     - `"lib": "https://url.com/mod.ts"`
     - `"lib/": "https://url.com/"`

## Naming conventions

### Files and directories

- Component/class files: `PascalCase.tsx`.
- Utility/module files: `kebab-case.ts`.
- Styles: `kebab-case.css` or `.scss` (internal styles can start with `_`).
- Pages and directories: `kebab-case`.
- Default module entrypoint: `mod.ts`.
- Internal modules: `_kebab-case.ts`.
- Never use `index.ts` or `index.js`. Use `mod.ts` when needed.
- Avoid barrel files in application code. A `mod.ts` is acceptable only for a
  narrow, intentional public API (not blind re-exports).
- `_`-prefixed files are internal and should be imported only within the same
  directory.

### Code identifiers

- Functions/methods and locals: `camelCase`.
- Types/interfaces/classes: `PascalCase`.
- Boolean names: use `is/has/can/should` prefixes.
- Use `UPPER_SNAKE_CASE` only for truly static module-level primitives, regexes,
  and frozen objects. Other `const` bindings should stay `camelCase`.

### Acronyms

- Follow regular `camelCase`/`PascalCase`; do not fully uppercase acronyms.
- Use `HttpServer`, `convertUrl()`, `parseHtmlFragment()`.

## TypeScript essentials

- Keep exported functions and shared contracts explicitly typed.
- Avoid `any`; use `unknown` and narrow safely.
- Prefer literal unions and `as const` over enums for finite option sets.
- Do not use non-null assertions (`!`); validate and fail early.
- Keep pure logic in helpers and side effects at action boundaries.
- Catch errors at I/O/SDK boundaries and log actionable context.
