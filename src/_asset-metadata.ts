import { extname } from "node:path";

import { typeByExtension } from "jsr/media-types";

const FORCED_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "atom.xml": "application/atom+xml",
  "feed.json": "application/feed+json",
  "rss.xml": "application/rss+xml",
});
const NO_CACHE_CONTROL_VALUE = "no-cache, max-age=0, must-revalidate";
const HOURLY_REVALIDATE_CACHE_CONTROL_VALUE =
  "public, max-age=3600, must-revalidate";
const WEEKLY_REVALIDATE_CACHE_CONTROL_VALUE =
  "public, max-age=604800, must-revalidate";
const IMMUTABLE_CACHE_CONTROL_VALUE = "public, max-age=31536000, immutable";
const HASHED_ASSET_PATTERN =
  /(?:\.[a-z0-9]{8,}|_(?=[a-z0-9]{7,}\.)[a-z0-9]*\d[a-z0-9]*)\.[^.]+$/i;
const HOURLY_REVALIDATE_EXTENSIONS = Object.freeze([
  "css",
  "js",
  "json",
  "pagefind",
  "txt",
  "webmanifest",
  "xml",
  "xsl",
]);
const WEEKLY_REVALIDATE_EXTENSIONS = Object.freeze([
  "avif",
  "ico",
  "jpg",
  "jpeg",
  "png",
  "svg",
  "webp",
  "woff",
  "woff2",
]);

export function guessContentType(
  absolutePath: string,
  relativePath: string,
): string {
  const normalizedRelativePath = relativePath.replaceAll("\\", "/")
    .toLowerCase();
  const fileName = normalizedRelativePath.split("/").at(-1) ??
    normalizedRelativePath;
  const forcedContentType = FORCED_CONTENT_TYPES[normalizedRelativePath] ??
    FORCED_CONTENT_TYPES[fileName];

  if (forcedContentType) {
    return forcedContentType;
  }

  // Fall back to "inline" when the MIME type cannot be inferred: OSS treats
  // this value as a signal to detect the content type from the file content.
  return typeByExtension(extname(absolutePath)) ?? "inline";
}

export function resolveCacheControl(relativePath: string): string | undefined {
  const normalizedPath = relativePath.replaceAll("\\", "/").toLowerCase();
  const fileName = normalizedPath.split("/").at(-1) ?? normalizedPath;
  const extension = fileName.split(".").at(-1);

  if (fileName === "sw.js" || normalizedPath.endsWith(".html")) {
    return NO_CACHE_CONTROL_VALUE;
  }

  if (HASHED_ASSET_PATTERN.test(fileName)) {
    return IMMUTABLE_CACHE_CONTROL_VALUE;
  }

  if (
    normalizedPath.startsWith("pagefind/") ||
    (extension && HOURLY_REVALIDATE_EXTENSIONS.includes(extension))
  ) {
    return HOURLY_REVALIDATE_CACHE_CONTROL_VALUE;
  }

  if (extension && WEEKLY_REVALIDATE_EXTENSIONS.includes(extension)) {
    return WEEKLY_REVALIDATE_CACHE_CONTROL_VALUE;
  }

  return undefined;
}
