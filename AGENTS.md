# AGENTS.md — aliyun-oss-cdn-sync-action

Source of truth for AI agent work in this repository.

Language policy:

- Repository-facing content must be in English: code, comments, commit messages,
  PR/MR titles, and documentation updates in this repo.
- Repository-facing English must be natural, fluent, and aligned with the
  Chicago Manual of Style.
- In repository documentation, use `Aliyun` as the provider name. Do not use
  `Alibaba Cloud`.
- Maintainer conversations and explanations can stay in French unless explicitly
  requested otherwise.

## Project structure

- `src/main.ts`: main workflow (OSS upload + CDN actions).
- `src/cleanup.ts`: post-action cleanup (remove orphan objects from OSS).
- `src/shared.ts`: shared helpers (inputs parsing, credentials, rate limiting).
- `action.yml`: GitHub Action definition (inputs, outputs, entrypoints).
- `deno.json`: Deno config and task definitions.
- `dist/`: compiled bundles executed by GitHub Actions (`node24`).

## Environment setup

- Runtime is Deno (version pinned in `.tool-versions`).
- If Deno is missing, install before running Deno tasks:

```bash
curl -fsSL https://deno.land/install.sh | sh
export PATH="$PATH:/root/.deno/bin"
```

- If TLS/certificate errors occur in this environment, prefix commands with:

```bash
DENO_TLS_CA_STORE=system
```

## Required workflow before finishing changes

Run:

```bash
DENO_TLS_CA_STORE=system deno task build
```

`deno task build` runs `deno lint` -> `deno task check` -> bundle generation in
`dist/` -> `deno fmt`.

Never commit changes in `src/` without regenerating `dist/`.

## Commit messages

### Setup

Commit message validation is handled by a zero-dependency, pure-Deno linter
(`src/lint-commit.ts`) wired into the `commit-msg` Git hook via
[Lefthook](https://github.com/evilmartians/lefthook) (`lefthook.yml`). Lefthook
is configured with `no_tty: true` so the hook fires correctly in non-interactive
environments — CI pipelines, AI agents, and headless shells included.

**Install the hook once after cloning:**

```bash
DENO_TLS_CA_STORE=system deno task hooks:install
```

This writes `.git/hooks/commit-msg`, which runs
`deno task lint-commit <msg-file>` on every `git commit`.

### Rules (mirrors `@commitlint/config-conventional`)

Follow the [Conventional Commits](https://www.conventionalcommits.org/)
specification. Every commit message is validated against these rules before it
is accepted:

| Rule                   | Severity | Description                                                                                                        |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `header-max-length`    | error    | Header must not exceed 100 characters.                                                                             |
| `header-trim`          | error    | Header must not have leading or trailing whitespace.                                                               |
| `header-pattern`       | error    | Header must match `<type>[optional scope][optional !]: <description>`.                                             |
| `type-enum`            | error    | Type must be one of: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`. |
| `type-case`            | error    | Type must be lower-case.                                                                                           |
| `type-empty`           | error    | Type must not be empty.                                                                                            |
| `subject-empty`        | error    | Subject must not be empty.                                                                                         |
| `subject-full-stop`    | error    | Subject must not end with a full stop (`.`).                                                                       |
| `scope-case`           | error    | Scope, when present, must be lower-case.                                                                           |
| `body-max-line-length` | error    | Each body/footer line must not exceed 100 characters.                                                              |
| `subject-case`         | error    | Subject must start with a lower-case letter.                                                                       |
| `body-leading-blank`   | warning  | Body must be separated from the header by a blank line.                                                            |

**Validate every commit message against the Conventional Commits specification
before pushing. Never use `git commit --no-verify`.** The hook must not be
bypassed.

### Release Please compatibility

For this repository, commit conventions are intentionally aligned with
`release-please` behavior:

- Breaking changes are recognized by either `!` in the header (for example
  `feat!: ...`) or by a `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer.
- Allowed commit types in `src/lint-commit.ts` are all parsed by
  `release-please`.
- Changelog defaults show `feat`, `fix`, `perf`, and `revert` as user-facing
  sections. Other allowed types (`build`, `chore`, `ci`, `docs`, `refactor`,
  `style`, `test`) are valid but hidden by default unless configured otherwise.
- Release bumping strategy is configured in
  `.github/release-please-config.json`. If `versioning` is set to a forced
  strategy (for example `always-bump-minor`), commit type no longer determines
  major/minor/patch increments.

## Development invariants

- Do not remove code to disable behavior. Use feature flags (for example
  `cdn-enabled`).
- CDN failures are non-fatal: warn, do not fail deployment.
- `cdn-base-url` is required only when `cdn-enabled: true`.
- Do not bypass `ApiRateLimiter` for OSS or CDN calls.
- `dist/` artifacts are versioned and must stay aligned with `src/`.
- Prefer `node:*` built-in imports over Deno native runtime APIs when both are
  viable. GitHub Actions executes these bundles on Node.js (`node24`), so Node
  built-ins provide the most reliable interoperability.

## Dependency and lockfile rules

- Do not add dependencies unless explicitly requested.
- Commit `deno.lock` only when dependencies changed intentionally in the same
  change.
- Use `deno task update-deps` when performing intentional dependency updates.

## Imports and dependencies

- Prefer `node:*` built-ins over Deno native APIs for runtime primitives (`fs`,
  `path`, `os`, `process`, and similar) unless there is a documented exception.
- Import order must be: (1) Node built-ins (`node:*`) -> (2) external
  dependencies -> (3) local modules.
- Separate each import group with one blank line.
- Use `import type` for type-only imports (enforced by
  `compilerOptions.verbatimModuleSyntax`).
- All external imports must be aliased in the `imports` field of `deno.json`
  (never in `import_map.json`).
- Alias values must use provider schemes:
  - Use `jsr:` for Deno packages.
  - Use `npm:` for npm packages.
  - Use `node:` for Node built-ins.
- Alias keys must follow `<provider>/<alias-name>`:
  - Prefix with `jsr/`, `npm/`, or `node/`.
  - Use a concise, stable, kebab-case alias name.
  - Do not use bare package keys such as `@scope/pkg` directly.
- Examples:
  - `"jsr/assert": "jsr:@std/assert@^1.0.19"`
  - `"jsr/testing-bdd": "jsr:@std/testing@^1.0.17/bdd"`
  - `"npm/faker-js": "npm:@faker-js/faker@^10.3.0"`
  - `"npm/opentelemetry-api": "npm:@opentelemetry/api@^1.9.0"`
  - `"node/path": "node:path"`

### Deno 2.x `deno.json` trailing slash rules

When generating or modifying the `imports` object in `deno.json`, apply these
rules strictly.

1. JSR, npm, and Node built-in aliases (`jsr/...`, `npm/...`, `node/...`)
   - Rule: no trailing slashes on either side.
   - Correct:
     - `"jsr/assert": "jsr:@std/assert@^1.0.19"`
     - `"npm/opentelemetry-api": "npm:@opentelemetry/api@^1.9.0"`
     - `"node/path": "node:path"`
   - Incorrect:
     - `"jsr/assert/": "jsr:@std/assert@^1.0.19/"`
     - `"npm/opentelemetry-api/": "npm:@opentelemetry/api@^1.9.0/"`
     - `"node/path/": "node:path/"`

2. Local directory aliases (prefix imports)
   - Rule: trailing slash is required on both key and value.
   - Correct: `"local/components/": "./src/components/"`
   - Incorrect:
     - `"local/components": "./src/components"`
     - `"local/components/": "./src/components"`

3. Exact local file aliases
   - Rule: no trailing slashes.
   - Correct: `"local/main": "./src/main.ts"`

4. Legacy HTTP imports (`https://...`)
   - Rule: avoid when possible; prefer `jsr:` or `npm:`.
   - If unavoidable and subpaths are needed, define both:
     - exact entry: `"lib": "https://url.com/mod.ts"`
     - directory prefix: `"lib/": "https://url.com/"`

## Naming conventions

### Files and directories

| Kind                | Convention                  | Example                 |
| ------------------- | --------------------------- | ----------------------- |
| Component / Class   | `PascalCase.tsx`            | `PostCard.tsx`          |
| Utility / module    | `kebab-case.ts`             | `date-helpers.ts`       |
| Styles              | `kebab-case.css` or `.scss` | `_post-card.css`        |
| Page                | `kebab-case`                | `about.page.tsx`        |
| Directory           | `kebab-case`                | `blog-posts/`           |
| Default entry point | `mod.ts`                    | `utils/mod.ts`          |
| Internal module     | `_kebab-case.ts`            | `_parse-frontmatter.ts` |

- Never use `index.ts` or `index.js`. Deno does not resolve them implicitly. Use
  `mod.ts` when a directory needs a default entry point.
- Never use barrel files (`index.ts` re-exporting everything) in application
  code. A `mod.ts` is acceptable only when it exposes a narrow, intentional
  public API for a self-contained module. It must not blindly re-export every
  symbol from every file in the directory.
- Files prefixed with `_` are internal: only files in the same directory should
  import them.

### Code identifiers

| Kind                                                     | Convention                 | Example         |
| -------------------------------------------------------- | -------------------------- | --------------- |
| Function / method                                        | `camelCase` (verb)         | `formatDate()`  |
| Local variable                                           | `camelCase`                | `currentPage`   |
| Module-level constant (primitive, RegExp, frozen object) | `UPPER_SNAKE_CASE`         | `MAX_PAGE_SIZE` |
| Type / Interface                                         | `PascalCase`               | `PostData`      |
| Class                                                    | `PascalCase`               | `HttpClient`    |
| Boolean                                                  | `is/has/can/should` prefix | `isVisible`     |

`UPPER_SNAKE_CASE` is reserved for truly static, module-level, immutable
primitives and frozen objects. Regular `const` bindings that happen to be
immutable should use standard `camelCase`.

### Acronyms in identifiers

Acronyms follow `camelCase` and `PascalCase` rules. Do not uppercase entire
acronyms:

- `HttpServer`, not `HTTPServer`.
- `convertUrl()`, not `convertURL()`.
- `parseHtmlFragment()`, not `parseHTMLFragment()`.

## TypeScript best practices (repo-focused)

- Keep exported APIs explicitly typed (function return types, shared interfaces,
  and action input/output shapes).
- Avoid `any`. Use `unknown` + narrowing (`instanceof`, property checks, custom
  guards). Use targeted suppressions only when truly unavoidable, with a short
  justification.
- Prefer string literal unions and `as const` objects over `enum` for finite
  sets (for example action modes and CDN action types).
- Do not use non-null assertions (`!`). Guard values explicitly and fail early
  with clear error messages.
- Keep side effects at boundaries (`src/main.ts`, `src/cleanup.ts`) and keep
  transformation logic pure in helpers (`src/shared.ts`).
- Use `try/catch` at SDK and I/O boundaries. Include actionable context in
  warnings/errors (status code, error code, request ID when available).
- Keep imports structured: Node built-ins, external dependencies, then local
  modules.
- Prefer `readonly` data where practical for configuration and function inputs
  that should not be mutated.

## Agent operating rules

- Keep changes minimal and pragmatic.
- Do not modify or delete documentation files unless explicitly requested.
- If a required command cannot be executed, state which command is needed and
  why.
