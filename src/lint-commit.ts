/**
 * Commit message linter — Conventional Commits specification.
 *
 * Reads the commit message from `.git/COMMIT_EDITMSG` (default) or the file
 * path supplied as the first CLI argument, then validates it against the rules
 * defined by `@commitlint/config-conventional` and prints a formatted report.
 *
 * Exit codes:
 *   0 — message is valid
 *   1 — one or more errors found
 *
 * Compatibility note:
 * - Header breaking marker `!` is accepted (for example `feat!: ...`).
 * - Footer/body breaking markers used by release-please are preserved
 *   (`BREAKING CHANGE:` and `BREAKING-CHANGE:`).
 *
 * @example
 * ```sh
 * # Validate the last commit message (Lefthook commit-msg hook):
 * deno task lint-commit .git/COMMIT_EDITMSG
 *
 * # Validate an arbitrary message (CI):
 * echo "feat: add search" | deno task lint-commit /dev/stdin
 * ```
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Severity level of a lint issue. */
export type Severity = "error" | "warning";

/** A single validation issue produced by the commit linter. */
export type LintIssue = {
  readonly rule: string;
  readonly severity: Severity;
  readonly message: string;
};

/** Full validation report returned by `lintCommit`. */
export type LintReport = {
  readonly input: string;
  readonly valid: boolean;
  readonly errors: ReadonlyArray<LintIssue>;
  readonly warnings: ReadonlyArray<LintIssue>;
};

// ── Constants (mirrors @commitlint/config-conventional) ────────────────────

/** Allowed commit types from `@commitlint/config-conventional`. */
const ALLOWED_TYPES = new Set(
  [
    "build",
    "chore",
    "ci",
    "docs",
    "feat",
    "fix",
    "perf",
    "refactor",
    "revert",
    "style",
    "test",
  ] as const,
);

/** Maximum character count for the header line. */
const HEADER_MAX_LENGTH = 100 as const;

/** Maximum character count for body and footer lines. */
const BODY_MAX_LINE_LENGTH = 100 as const;

/**
 * Conventional Commits header pattern.
 * Captures type, optional scope, optional breaking-change marker, and subject.
 */
const HEADER_PATTERN =
  /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^()]+)\))?(?<breaking>!)?:[ \t]+(?<subject>.+)$/;

// ── Parser ─────────────────────────────────────────────────────────────────

type ParsedHeader = {
  readonly type: string;
  readonly scope: string | undefined;
  readonly breaking: boolean;
  readonly subject: string;
};

/** Parses the Conventional Commits header line. Returns `undefined` on mismatch. */
function parseHeader(header: string): ParsedHeader | undefined {
  const match = HEADER_PATTERN.exec(header);
  if (match === null) return undefined;

  const groups = match.groups as Record<string, string | undefined>;
  const type = groups["type"] ?? "";
  const scope = groups["scope"];
  const breaking = groups["breaking"] === "!";
  const subject = groups["subject"] ?? "";

  return { type, scope, breaking, subject };
}

// ── Rules ──────────────────────────────────────────────────────────────────

/** Validates the commit message and returns a lint report. */
export function lintCommit(input: string): LintReport {
  const issues: LintIssue[] = [];

  // Strip trailing newline (common in COMMIT_EDITMSG files) and comment lines.
  // Git uses '#' as the default commentChar; lines may be "# text" or bare "#".
  const cleaned = input
    .split("\n")
    .filter((line) => !/^#/.test(line))
    .join("\n")
    .trimEnd();

  const lines = cleaned.split("\n");
  const header = lines[0] ?? "";

  // ── header-max-length ──────────────────────────────────────────────────
  if (header.length > HEADER_MAX_LENGTH) {
    issues.push({
      rule: "header-max-length",
      severity: "error",
      message:
        `Header must not exceed ${HEADER_MAX_LENGTH} characters (got ${header.length}).`,
    });
  }

  // ── header-trim ────────────────────────────────────────────────────────
  if (header !== header.trim()) {
    issues.push({
      rule: "header-trim",
      severity: "error",
      message: "Header must not have leading or trailing whitespace.",
    });
  }

  // ── Parse the header ───────────────────────────────────────────────────
  const parsed = parseHeader(header);

  if (parsed === undefined) {
    issues.push({
      rule: "header-pattern",
      severity: "error",
      message:
        `Header does not match Conventional Commits format: "<type>[optional scope]: <description>". Got: "${header}"`,
    });
  } else {
    // ── type-enum ──────────────────────────────────────────────────────
    if (
      !ALLOWED_TYPES.has(parsed.type as Parameters<typeof ALLOWED_TYPES.has>[0])
    ) {
      issues.push({
        rule: "type-enum",
        severity: "error",
        message: `Type "${parsed.type}" is not allowed. Allowed types: ${
          [...ALLOWED_TYPES].join(", ")
        }.`,
      });
    }

    // ── type-case ─────────────────────────────────────────────────────
    if (parsed.type !== parsed.type.toLowerCase()) {
      issues.push({
        rule: "type-case",
        severity: "error",
        message: `Type "${parsed.type}" must be lower-case.`,
      });
    }

    // ── type-empty ────────────────────────────────────────────────────
    if (parsed.type.trim().length === 0) {
      issues.push({
        rule: "type-empty",
        severity: "error",
        message: "Type must not be empty.",
      });
    }

    // ── subject-empty ─────────────────────────────────────────────────
    if (parsed.subject.trim().length === 0) {
      issues.push({
        rule: "subject-empty",
        severity: "error",
        message: "Subject must not be empty.",
      });
    }

    // ── subject-full-stop ─────────────────────────────────────────────
    if (parsed.subject.trimEnd().endsWith(".")) {
      issues.push({
        rule: "subject-full-stop",
        severity: "error",
        message: 'Subject must not end with a full stop (".").',
      });
    }

    // ── subject-case ──────────────────────────────────────────────────
    // config-conventional forbids sentence-case, start-case, pascal-case,
    // and upper-case (i.e. the subject must begin with a lower-case letter).
    const first = parsed.subject.trimStart()[0];
    if (first !== undefined && first !== first.toLowerCase()) {
      issues.push({
        rule: "subject-case",
        severity: "error",
        message:
          `Subject must start with a lower-case letter (got "${first}").`,
      });
    }

    // ── scope-case ────────────────────────────────────────────────────
    if (
      parsed.scope !== undefined &&
      parsed.scope !== parsed.scope.toLowerCase()
    ) {
      issues.push({
        rule: "scope-case",
        severity: "error",
        message: `Scope "${parsed.scope}" must be lower-case.`,
      });
    }
  }

  // ── body-max-line-length ─────────────────────────────────────────────
  for (const [index, line] of lines.slice(2).entries()) {
    if (line.length > BODY_MAX_LINE_LENGTH) {
      issues.push({
        rule: "body-max-line-length",
        severity: "error",
        message: `Body line ${
          index + 3
        } must not exceed ${BODY_MAX_LINE_LENGTH} characters (got ${line.length}).`,
      });
    }
  }

  // ── body-leading-blank ───────────────────────────────────────────────
  if (lines.length > 1 && lines[1] !== "") {
    issues.push({
      rule: "body-leading-blank",
      severity: "warning",
      message: "Body must be separated from the header by a blank line.",
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return {
    input: cleaned,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── Formatter ──────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

/** Returns true when stdout is a real TTY (colors enabled). */
function supportsColor(): boolean {
  return Deno.stdout.isTerminal();
}

/** Formats and prints the lint report to stdout. */
function printReport(report: LintReport): void {
  const color = supportsColor();

  const c = (code: string, text: string) =>
    color ? `${code}${text}${RESET}` : text;

  console.log();
  console.log(c(DIM, `  commit: ${report.input.split("\n")[0]}`));
  console.log();

  for (const issue of [...report.errors, ...report.warnings]) {
    const prefix = issue.severity === "error"
      ? c(RED, "  ✖ error")
      : c(YELLOW, "  ⚠ warning");
    const rule = c(DIM, `  [${issue.rule}]`);
    console.log(`${prefix}  ${issue.message}`);
    console.log(`${rule}`);
    console.log();
  }

  const errorCount = report.errors.length;
  const warningCount = report.warnings.length;

  if (report.valid) {
    console.log(c(GREEN, `  ${BOLD}✔ commit message is valid${RESET}`));
  } else {
    console.log(
      c(
        RED,
        `  ${BOLD}✖ found ${errorCount} error${errorCount !== 1 ? "s" : ""}` +
          (warningCount > 0
            ? ` and ${warningCount} warning${warningCount !== 1 ? "s" : ""}`
            : "") +
          RESET,
      ),
    );
  }

  console.log();
}

// ── Entry point ────────────────────────────────────────────────────────────

/** Reads the commit message, runs the linter, and exits with the appropriate code. */
async function main(): Promise<void> {
  const commitMsgPath = Deno.args[0] ?? ".git/COMMIT_EDITMSG";

  let raw: string;
  try {
    raw = await Deno.readTextFile(commitMsgPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      console.error(
        `lint-commit: cannot read commit message file: ${commitMsgPath}`,
      );
      Deno.exit(1);
    }
    throw err;
  }

  const report = lintCommit(raw);
  printReport(report);

  if (!report.valid) Deno.exit(1);
}

if (import.meta.main) await main();
