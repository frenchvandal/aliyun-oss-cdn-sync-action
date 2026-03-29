import {
  firstNonEmptyLine,
  resolveBuildCommandExecutable,
  tokenizeBuildCommand,
} from "./_build-command.ts";
import { assertDeepEquals, assertEquals } from "./_test-helpers.ts";

Deno.test("tokenizeBuildCommand preserves quoted segments and escaped spaces", () => {
  assertDeepEquals(
    tokenizeBuildCommand('FOO=bar deno task "build site" path\\ with\\ spaces'),
    ["FOO=bar", "deno", "task", "build site", "path with spaces"],
  );
});

Deno.test("resolveBuildCommandExecutable skips leading environment assignments", () => {
  assertEquals(
    resolveBuildCommandExecutable("FOO=bar BAR=baz deno task build"),
    "deno",
  );
});

Deno.test("firstNonEmptyLine returns the first trimmed non-empty line", () => {
  assertEquals(
    firstNonEmptyLine("\n  \n  deno 2.5.4  \nnode 24"),
    "deno 2.5.4",
  );
});
