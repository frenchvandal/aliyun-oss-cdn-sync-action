import { extname } from "node:path";

const FORCED_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "atom.xml": "application/atom+xml",
  "feed.json": "application/feed+json",
  "feed.xml": "application/rss+xml",
});

const CONTENT_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = Object
  .freeze({
    ".atom": "application/atom+xml",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".css": "text/css; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".eot": "application/vnd.ms-fontobject",
    ".gif": "image/gif",
    ".gz": "application/gzip",
    ".htm": "text/html; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".m4a": "audio/mp4",
    ".m4v": "video/mp4",
    ".map": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".otf": "font/otf",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".rss": "application/rss+xml",
    ".svg": "image/svg+xml",
    ".tiff": "image/tiff",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".wav": "audio/wav",
    ".webmanifest": "application/manifest+json",
    ".webm": "video/webm",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".xml": "application/xml; charset=utf-8",
    ".xsl": "application/xml; charset=utf-8",
    ".yaml": "application/yaml; charset=utf-8",
    ".yml": "application/yaml; charset=utf-8",
    ".zip": "application/zip",
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
  return CONTENT_TYPES_BY_EXTENSION[extname(absolutePath).toLowerCase()] ??
    "inline";
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
