import { readFile } from "node:fs/promises";
import { argv, exit, stdout } from "node:process";

import {
  formatReport,
  lintCommit as lintCommitWithPreset,
} from "jsr/commitlint";
import type { LintReport } from "jsr/commitlint";

export type { LintIssue, LintReport, Severity } from "jsr/commitlint";

function supportsColor(): boolean {
  return stdout.isTTY === true;
}

export function lintCommit(input: string): LintReport {
  return lintCommitWithPreset(input, { preset: "commitlint" });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function readCommitMessage(commitMsgPath: string): Promise<string> {
  if (commitMsgPath === "-" || commitMsgPath === "/dev/stdin") {
    return await new Response(Deno.stdin.readable).text();
  }

  const commitMessageBuffer = await readFile(commitMsgPath);
  return commitMessageBuffer.toString("utf8");
}

async function main(): Promise<void> {
  const commitMsgPath = argv[2] ?? ".git/COMMIT_EDITMSG";

  let raw: string;
  try {
    raw = await readCommitMessage(commitMsgPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      console.error(
        `lint-commit: cannot read commit message file: ${commitMsgPath}`,
      );
      exit(1);
    }

    throw error;
  }

  const report = lintCommit(raw);
  console.log(formatReport(report, { color: supportsColor() }));

  if (!report.valid) {
    exit(1);
  }
}

if (import.meta.main) {
  await main();
}
