import { ApiRateLimiter } from "./_api-rate-limiter.ts";
import {
  buildFileUrl,
  buildObjectKey,
  errorMessage,
  parsePositiveIntegerValue,
  parsePrefix,
  parseQuota,
  resolveDefaultConstructor,
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

Deno.test("resolveDefaultConstructor unwraps every CJS interop shape", () => {
  class Client {}

  // Direct constructor (module.exports = Client).
  assertEquals(resolveDefaultConstructor(Client, "direct"), Client);
  // Babel-style interop: default import resolves to exports.default.
  assertEquals(resolveDefaultConstructor({ default: Client }, "babel"), Client);
  // Node-style interop on a namespace import of a transpiled module:
  // namespace.default is module.exports, whose .default is the class.
  assertEquals(
    resolveDefaultConstructor(
      { default: { __esModule: true, default: Client } },
      "node",
    ),
    Client,
  );
  assertThrows(
    () => resolveDefaultConstructor({ default: {} }, "broken-module"),
    "Unable to resolve the default export of 'broken-module' as a constructor",
  );
  assertThrows(
    () => resolveDefaultConstructor(undefined, "missing-module"),
    "Unable to resolve the default export of 'missing-module' as a constructor",
  );
});

Deno.test("ApiRateLimiter rejects invalid limits", () => {
  assertThrows(
    () => new ApiRateLimiter(0),
    "limitPerSecond must be a positive finite number",
  );
  assertThrows(
    () => new ApiRateLimiter(Number.NaN),
    "limitPerSecond must be a positive finite number",
  );
});

Deno.test("ApiRateLimiter spaces request starts without serializing in-flight work", async () => {
  const limiter = new ApiRateLimiter(20);
  const startTimes: number[] = [];
  let activeCount = 0;
  let maxActiveCount = 0;

  await Promise.all([
    limiter.schedule(async () => {
      startTimes.push(Date.now());
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, 120));
      activeCount -= 1;
    }),
    limiter.schedule(async () => {
      startTimes.push(Date.now());
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCount -= 1;
    }),
  ]);

  if (startTimes.length !== 2) {
    throw new Error(
      `Expected 2 scheduled starts, received ${startTimes.length}`,
    );
  }

  const firstStart = startTimes[0];
  const secondStart = startTimes[1];
  if (firstStart === undefined || secondStart === undefined) {
    throw new Error("Expected both scheduled start timestamps to be present");
  }

  const deltaMs = secondStart - firstStart;
  if (deltaMs < 40) {
    throw new Error(
      `Expected request starts to be spaced, received delta=${deltaMs}ms`,
    );
  }

  if (maxActiveCount < 2) {
    throw new Error(
      "Expected overlapping in-flight work after rate-limit reservation",
    );
  }
});

Deno.test("ApiRateLimiter keeps scheduling after a rejected call", async () => {
  const limiter = new ApiRateLimiter(20);
  const startTimes: number[] = [];

  const failingCall = limiter.schedule(() => {
    startTimes.push(Date.now());
    return Promise.reject(new Error("boom"));
  });
  const succeedingCall = limiter.schedule(() => {
    startTimes.push(Date.now());
    return Promise.resolve("ok");
  });

  await failingCall.catch(() => undefined);
  const result = await succeedingCall;

  assertEquals(result, "ok");

  if (startTimes.length !== 2) {
    throw new Error(
      `Expected 2 scheduled starts, received ${startTimes.length}`,
    );
  }

  const firstStart = startTimes[0];
  const secondStart = startTimes[1];
  if (firstStart === undefined || secondStart === undefined) {
    throw new Error("Expected both scheduled start timestamps to be present");
  }

  const deltaMs = secondStart - firstStart;
  if (deltaMs < 40) {
    throw new Error(
      `Expected rejected call to preserve start spacing, received delta=${deltaMs}ms`,
    );
  }
});
