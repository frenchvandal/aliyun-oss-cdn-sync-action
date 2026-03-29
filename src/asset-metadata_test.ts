import { guessContentType, resolveCacheControl } from "./_asset-metadata.ts";
import { assertEquals } from "./_test-helpers.ts";

Deno.test("guessContentType applies feed-specific MIME types by basename", () => {
  assertEquals(
    guessContentType("/tmp/output/blog/atom.xml", "blog/atom.xml"),
    "application/atom+xml",
  );
  assertEquals(
    guessContentType("/tmp/output/nested/feed.json", "nested/feed.json"),
    "application/feed+json",
  );
});

Deno.test("guessContentType falls back to inline when no extension mapping exists", () => {
  assertEquals(
    guessContentType(
      "/tmp/output/assets/blob.unknownext",
      "assets/blob.unknownext",
    ),
    "inline",
  );
});

Deno.test("resolveCacheControl keeps unhashed underscored files revalidating", () => {
  assertEquals(
    resolveCacheControl("assets/_settings.js"),
    "public, max-age=3600, must-revalidate",
  );
});

Deno.test("resolveCacheControl treats hashed assets as immutable", () => {
  assertEquals(
    resolveCacheControl("assets/chunk_a1b2c3d.js"),
    "public, max-age=31536000, immutable",
  );
});

Deno.test("resolveCacheControl disables caching for HTML and service worker files", () => {
  assertEquals(
    resolveCacheControl("index.html"),
    "no-cache, max-age=0, must-revalidate",
  );
  assertEquals(
    resolveCacheControl("sw.js"),
    "no-cache, max-age=0, must-revalidate",
  );
});
