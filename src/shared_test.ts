import {
  buildFileUrl,
  buildObjectKey,
  errorMessage,
  parsePositiveIntegerValue,
  parsePrefix,
  parseQuota,
  resolveOssEndpoint,
  selectByQuota,
} from "./_shared-utils.ts";
import {
  assertDeepEquals,
  assertEquals,
  assertThrows,
} from "./_test-helpers.ts";

Deno.test("buildObjectKey joins prefixes without introducing a leading slash", () => {
  assertEquals(buildObjectKey("", "index.html"), "index.html");
  assertEquals(buildObjectKey("blog", "index.html"), "blog/index.html");
});

Deno.test("buildFileUrl normalizes leading and trailing slashes", () => {
  assertEquals(
    buildFileUrl("https://cdn.example.com/root", "/assets/app.js"),
    "https://cdn.example.com/root/assets/app.js",
  );
});

Deno.test("parsePrefix normalizes Windows separators and outer slashes", () => {
  assertEquals(parsePrefix("\\nested\\content\\"), "nested/content");
});

Deno.test("parsePositiveIntegerValue validates bounds", () => {
  assertEquals(parsePositiveIntegerValue("max-concurrency", "5", 1), 5);
  assertThrows(
    () => parsePositiveIntegerValue("api-rps-limit", "10001", 1, 10000),
    "'api-rps-limit' must be <= 10000",
  );
});

Deno.test("parseQuota and selectByQuota clamp invalid values safely", () => {
  assertEquals(parseQuota(undefined), 0);
  assertEquals(parseQuota("9"), 9);
  assertDeepEquals(selectByQuota(["a", "b", "c"], 2), {
    allowed: ["a", "b"],
    deniedCount: 1,
  });
});

Deno.test("errorMessage extracts Aliyun-style diagnostic fields", () => {
  assertEquals(
    errorMessage({
      message: "Forbidden",
      code: "AccessDenied",
      statusCode: 403,
      data: { RequestId: "ABC123" },
    }),
    "Forbidden, code=AccessDenied, statusCode=403, requestId=ABC123",
  );
});

Deno.test("resolveOssEndpoint accepts default regions and explicit URLs", () => {
  assertEquals(
    resolveOssEndpoint("oss-cn-hangzhou", undefined),
    "oss-cn-hangzhou.aliyuncs.com",
  );
  assertEquals(
    resolveOssEndpoint(
      "oss-cn-hangzhou",
      "https://oss-cn-shanghai.aliyuncs.com",
    ),
    "oss-cn-shanghai.aliyuncs.com",
  );
});
