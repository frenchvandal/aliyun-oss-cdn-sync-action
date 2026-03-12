import { dirname } from "node:path";
import { resolve } from "node:path";

import {
  debug,
  group,
  info,
  isDebug,
  saveState,
  setFailed,
  setOutput,
  summary,
  warning,
} from "@actions/core";
type SummaryTableRow = Array<{ data: string; header?: boolean } | string>;
import * as Cdn from "@alicloud/cdn20180510";
import * as AliOssModule from "ali-oss";
import mime from "mime-types";

import {
  ApiRateLimiter,
  buildFileUrl,
  buildObjectKey,
  collectFiles,
  getOptionalInput,
  parseBooleanInput,
  parseOssBaseInputs,
  resolveCredentials,
  resolveCredentialsFromState,
  resolveOssEndpoint,
} from "./shared.ts";
import {
  type OidcInputs,
  parseOidcInputs,
  resolveOidcCredential,
} from "./oidc.ts";
import {
  STATE_CDN_PRELOAD_TASK_IDS,
  STATE_CDN_REFRESH_TASK_IDS,
} from "./constants.ts";
import type { Credentials, FileEntry } from "./shared.ts";

type CdnAction = "refresh" | "preload";
type ResponseHeaders = Record<string, unknown>;
type CdnResponseBody = Record<string, unknown>;
type CdnApiResponse<TBody extends CdnResponseBody> = {
  statusCode?: number;
  headers?: ResponseHeaders;
  body?: TBody;
};
type BatchSubmissionResult = {
  taskIds: string[];
  submittedBatches: number;
  submittedUrls: number;
};
type QuotaSelection<T> = {
  allowed: T[];
  deniedCount: number;
};

interface Inputs {
  inputDir: string;
  bucket: string;
  region: string;
  destinationPrefix: string;
  endpoint: string | undefined;
  maxConcurrency: number;
  apiRpsLimit: number;
  sdkTimeoutMs: number;
  overwrite: boolean;
  cdnEnabled: boolean;
  cdnBaseUrl: string;
  cdnEndpoint: string | undefined;
  cdnActions: Set<CdnAction>;
  oidc: OidcInputs;
}

type OSSResponse = {
  res?: {
    status?: number;
    headers?: Record<string, string>;
  };
};

type OSSClient = {
  head(key: string): Promise<{ res: { headers: Record<string, string> } }>;
  put(
    key: string,
    file: string,
    options: { mime: string; headers: Record<string, string> },
  ): Promise<OSSResponse>;
};

type CdnClient = {
  describeRefreshQuota(
    request: unknown,
  ): Promise<
    CdnApiResponse<{
      requestId?: string;
      urlRemain?: string;
      dirRemain?: string;
      preloadRemain?: string;
    }>
  >;
  refreshObjectCaches(
    request: unknown,
  ): Promise<CdnApiResponse<{ requestId?: string; refreshTaskId?: string }>>;
  pushObjectCache(
    request: unknown,
  ): Promise<CdnApiResponse<{ requestId?: string; pushTaskId?: string }>>;
};

// deno-lint-ignore no-explicit-any
const OssClientCtor = (AliOssModule as any).default as new (
  config: Record<string, unknown>,
) => OSSClient;

const CdnClientCtor = Cdn.default as unknown as new (
  config: Record<string, unknown>,
) => CdnClient;
const DescribeRefreshQuotaRequestCtor = Cdn
  .DescribeRefreshQuotaRequest as unknown as new (
    map?: Record<string, unknown>,
  ) => unknown;
const RefreshObjectCachesRequestCtor = Cdn
  .RefreshObjectCachesRequest as unknown as new (
    map?: Record<string, unknown>,
  ) => unknown;
const PushObjectCacheRequestCtor = Cdn
  .PushObjectCacheRequest as unknown as new (
    map?: Record<string, unknown>,
  ) => unknown;
// Alibaba Cloud CDN API accepts at most 100 URLs per refresh/preload request.
const CDN_MAX_URLS_PER_REQUEST = 100;
// RefreshObjectCaches and PushObjectCache: 50 req/s.
const CDN_API_MAX_RPS = 50;
// DescribeRefreshQuota: 20 req/s (stricter endpoint).
const CDN_QUOTA_API_MAX_RPS = 20;
// Maximum number of upload retry attempts per file.
const MAX_UPLOAD_RETRIES = 3;
const ANSI_BOLD = "\u001b[1m";
const ANSI_FG_CYAN = "\u001b[38;5;45m";
const ANSI_FG_GRAY = "\u001b[38;5;240m";
const ANSI_FG_GREEN = "\u001b[38;5;46m";
const ANSI_FG_RED = "\u001b[38;5;203m";
const ANSI_FG_YELLOW = "\u001b[38;5;220m";
const ANSI_RESET = "\u001b[0m";
const UPLOAD_PROGRESS_BAR_WIDTH = 30;
const UPLOAD_PROGRESS_PERCENT_STEP = 1;
const NO_CACHE_CONTROL_VALUE = "no-cache, max-age=0, must-revalidate";
const IMMUTABLE_CACHE_CONTROL_VALUE = "public, max-age=31536000, immutable";
const HASHED_ASSET_PATTERN = /\.[a-z0-9_-]{6,}\.(css|js)$/i;

function parseActions(
  raw: string | undefined,
  inputName: string,
  cdnEnabled: boolean,
): Set<CdnAction> {
  if (!raw || raw.trim() === "") {
    if (cdnEnabled) {
      info(
        `CDN is enabled but input '${inputName}' is empty. Expected 'refresh' or 'refresh,preload'. Defaulting to 'refresh'.`,
      );
      return new Set<CdnAction>(["refresh"]);
    }
    return new Set();
  }

  const normalizedTokens = Array.from(
    new Set(raw.split(",").map((item) => item.trim().toLowerCase())),
  ).filter((token) => token !== "");
  const hasUnsupportedTokens = normalizedTokens.some((token) =>
    token !== "refresh" && token !== "preload"
  );
  const hasRefresh = normalizedTokens.includes("refresh");

  if (hasUnsupportedTokens || !hasRefresh) {
    if (cdnEnabled) {
      info(
        `CDN is enabled but input '${inputName}' has unsupported value(s): '${raw}'. Expected 'refresh' or 'refresh,preload'. Defaulting to 'refresh'.`,
      );
      return new Set<CdnAction>(["refresh"]);
    }
    return new Set();
  }

  const actions = new Set<CdnAction>(["refresh"]);
  if (normalizedTokens.includes("preload")) {
    actions.add("preload");
  }

  return actions;
}

function guessContentType(path: string): string {
  // Fall back to "inline" when the MIME type cannot be inferred: OSS treats
  // this value as a signal to detect the content type from the file content.
  return mime.lookup(path) || "inline";
}

function resolveCacheControl(relativePath: string): string | undefined {
  const normalizedPath = relativePath.replaceAll("\\", "/").toLowerCase();
  const fileName = normalizedPath.split("/").at(-1) ?? normalizedPath;

  if (fileName === "sw.js" || normalizedPath.endsWith(".html")) {
    return NO_CACHE_CONTROL_VALUE;
  }

  if (HASHED_ASSET_PATTERN.test(fileName)) {
    return IMMUTABLE_CACHE_CONTROL_VALUE;
  }

  return undefined;
}

function colorize(ansiCode: string, value: string): string {
  return `${ansiCode}${value}${ANSI_RESET}`;
}

function buildUploadProgressBar(
  processedCount: number,
  totalCount: number,
): string {
  const safeTotal = Math.max(totalCount, 1);
  const ratio = Math.max(0, Math.min(1, processedCount / safeTotal));
  const filledWidth = Math.round(ratio * UPLOAD_PROGRESS_BAR_WIDTH);
  const emptyWidth = UPLOAD_PROGRESS_BAR_WIDTH - filledWidth;
  const filled = filledWidth > 0
    ? colorize(ANSI_FG_GREEN, "=".repeat(filledWidth))
    : "";
  const empty = emptyWidth > 0
    ? colorize(ANSI_FG_GRAY, "-".repeat(emptyWidth))
    : "";

  return `[${filled}${empty}]`;
}

function logUploadProgress(
  processedCount: number,
  totalCount: number,
  uploadedCount: number,
  skippedCount: number,
  failedCount: number,
): void {
  const safeTotal = Math.max(totalCount, 1);
  const percent = Math.floor((processedCount / safeTotal) * 100);

  info(
    `${colorize(`${ANSI_BOLD}${ANSI_FG_CYAN}`, "OSS upload progress")} ${
      buildUploadProgressBar(processedCount, totalCount)
    } ${colorize(ANSI_BOLD, `${percent}%`)} (${processedCount}/${totalCount}) ${
      colorize(ANSI_FG_GREEN, `uploaded=${uploadedCount}`)
    } ${colorize(ANSI_FG_YELLOW, `skipped=${skippedCount}`)} ${
      failedCount > 0
        ? colorize(ANSI_FG_RED, `failed=${failedCount}`)
        : colorize(ANSI_FG_GRAY, `failed=${failedCount}`)
    }`,
  );
}

function parseInputs(): Inputs {
  const base = parseOssBaseInputs();
  const oidc = parseOidcInputs();

  const cdnEnabled = parseBooleanInput("cdn-enabled", false);
  const cdnActions = parseActions(
    getOptionalInput("cdn-actions"),
    "cdn-actions",
    cdnEnabled,
  );

  const cdnBaseUrlInput = getOptionalInput("cdn-base-url");
  if (cdnEnabled && !cdnBaseUrlInput) {
    throw new Error("'cdn-base-url' is required when cdn-enabled is true");
  }

  let cdnBaseUrl = "";
  if (cdnBaseUrlInput) {
    const parsed = new URL(cdnBaseUrlInput);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("'cdn-base-url' must start with http:// or https://");
    }
    cdnBaseUrl = parsed.toString();
  }

  return {
    ...base,
    overwrite: parseBooleanInput("overwrite", true),
    cdnEnabled,
    cdnBaseUrl,
    cdnEndpoint: getOptionalInput("cdn-endpoint"),
    cdnActions,
    oidc,
  };
}

function createOssClient(inputs: Inputs, credentials: Credentials): OSSClient {
  const authType = credentials.securityToken ? "sts" : "access_key";
  debug(
    `[main:createOssClient] authType=${authType} hasSecurityToken=${
      Boolean(credentials.securityToken)
    } region=${inputs.region}`,
  );

  const clientConfig: Record<string, unknown> = {
    endpoint: resolveOssEndpoint(inputs.region, inputs.endpoint),
    bucket: inputs.bucket,
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    stsToken: credentials.securityToken,
    secure: true,
    timeout: inputs.sdkTimeoutMs,
  };

  if (credentials.securityToken) {
    clientConfig.refreshSTSToken = async () => {
      const refreshed = await resolveOidcCredential(inputs.oidc);
      return {
        accessKeyId: refreshed.accessKeyId,
        accessKeySecret: refreshed.accessKeySecret,
        stsToken: refreshed.securityToken,
      };
    };
    clientConfig.refreshSTSTokenInterval =
      inputs.oidc.refreshStsTokenIntervalMs;
  }

  return new OssClientCtor(clientConfig);
}

function createCdnClient(inputs: Inputs, credentials: Credentials): CdnClient {
  debug(
    `[main:createCdnClient] hasSecurityToken=${
      Boolean(credentials.securityToken)
    }`,
  );
  return new CdnClientCtor({
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    securityToken: credentials.securityToken,
    // Alibaba Cloud CDN is a global service; regionId is required by the Tea
    // SDK for internal endpoint resolution but has no effect on routing.
    // Strip the OSS-specific "oss-" prefix to derive a Tea-compatible region.
    regionId: inputs.region.replace(/^oss-/, ""),
    endpoint: inputs.cdnEndpoint,
    protocol: "HTTPS",
    readTimeout: inputs.sdkTimeoutMs,
    connectTimeout: inputs.sdkTimeoutMs,
  });
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const e = error as Record<string, unknown>;
  return e.status === 404 || e.code === "NoSuchKey";
}

async function objectExists(
  client: OSSClient,
  limiter: ApiRateLimiter,
  key: string,
): Promise<boolean> {
  try {
    await limiter.schedule(() => client.head(key));
    return true;
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

type UploadFailure = { relativePath: string; key: string; error: string };

async function uploadFiles(
  ossClient: OSSClient,
  limiter: ApiRateLimiter,
  files: FileEntry[],
  inputs: Inputs,
): Promise<{
  uploadedKeys: string[];
  uploadedCount: number;
  skippedCount: number;
  failedCount: number;
  failedFiles: UploadFailure[];
}> {
  const debugModeEnabled = isDebug();
  const totalFiles = files.length;
  const queue = [...files];
  const uploadedKeys: string[] = [];
  const failedFiles: UploadFailure[] = [];
  let uploadedCount = 0;
  let processedCount = 0;
  let skippedCount = 0;
  let lastReportedPercent = -UPLOAD_PROGRESS_PERCENT_STEP;

  function reportProgress(force = false): void {
    if (debugModeEnabled) {
      return;
    }

    const safeTotal = Math.max(totalFiles, 1);
    const percent = Math.floor((processedCount / safeTotal) * 100);

    if (
      !force && percent < lastReportedPercent + UPLOAD_PROGRESS_PERCENT_STEP
    ) {
      return;
    }

    lastReportedPercent = percent;
    logUploadProgress(
      processedCount,
      totalFiles,
      uploadedCount,
      skippedCount,
      failedFiles.length,
    );
  }

  function markFileProcessed(): void {
    processedCount += 1;
    reportProgress();
  }

  reportProgress(true);

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) {
        return;
      }

      const key = buildObjectKey(inputs.destinationPrefix, file.relativePath);

      if (!inputs.overwrite) {
        const exists = await objectExists(ossClient, limiter, key);
        if (exists) {
          skippedCount += 1;
          debug(`Skipped existing object: ${key}`);
          markFileProcessed();
          continue;
        }
      }

      let lastError: unknown;
      let uploaded = false;
      let uploadStatusCode: number | undefined;
      let uploadRequestId: string | undefined;
      let uploadEtag: string | undefined;
      const uploadHeaders: Record<string, string> = {
        "x-oss-object-acl": "public-read",
      };
      const cacheControl = resolveCacheControl(file.relativePath);
      if (cacheControl) {
        uploadHeaders["Cache-Control"] = cacheControl;
      }
      for (let attempt = 1; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
        try {
          const response = await limiter.schedule(() =>
            ossClient.put(
              key,
              file.absolutePath,
              {
                mime: guessContentType(file.absolutePath),
                headers: uploadHeaders,
              },
            )
          );
          uploadStatusCode = response.res?.status;
          uploadRequestId = resolveRequestId(undefined, response.res?.headers);
          uploadEtag = getHeaderValue(response.res?.headers, "etag");
          uploaded = true;
          break;
        } catch (error: unknown) {
          lastError = error;
          if (attempt < MAX_UPLOAD_RETRIES) {
            warning(
              `Upload attempt ${attempt}/${MAX_UPLOAD_RETRIES} failed for ${key}: ${
                errorMessage(error)
              }, retrying...`,
            );
          }
        }
      }

      if (uploaded) {
        uploadedCount += 1;
        uploadedKeys.push(key);
        debug(
          `Uploaded ${file.relativePath} -> oss://${inputs.bucket}/${key} (statusCode=${
            uploadStatusCode ?? "unknown"
          }, requestId=${uploadRequestId ?? "n/a"}, etag=${
            uploadEtag ?? "n/a"
          })`,
        );
        markFileProcessed();
      } else {
        const err = errorMessage(lastError);
        warning(
          `Upload failed after ${MAX_UPLOAD_RETRIES} attempts for ${key}: ${err}`,
        );
        failedFiles.push({ relativePath: file.relativePath, key, error: err });
        markFileProcessed();
      }
    }
  }

  const workerCount = Math.min(
    inputs.maxConcurrency,
    Math.max(1, files.length),
  );
  const workerResults = await Promise.allSettled(
    Array.from({ length: workerCount }, () => worker()),
  );
  uploadedKeys.sort((a, b) => a.localeCompare(b));

  const workerFailures = workerResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  if (workerFailures.length > 0) {
    const workerFailurePreview = workerFailures.slice(0, 3).map((failure) =>
      errorMessage(failure.reason)
    );
    throw new Error(
      `Upload workers encountered ${workerFailures.length} unrecoverable error(s): [${
        workerFailurePreview.join(", ")
      }]`,
    );
  }

  reportProgress(true);

  return {
    uploadedKeys,
    uploadedCount,
    skippedCount,
    failedCount: failedFiles.length,
    failedFiles,
  };
}

function buildDirectoryUrl(baseUrl: string, key: string): string {
  const normalizedDir = key === ""
    ? ""
    : `${key.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
  return buildFileUrl(baseUrl, normalizedDir);
}

function directoryPrefix(key: string): string {
  return `${key.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
}

function collapseRecursiveDirectories(
  directoryKeys: readonly string[],
): string[] {
  const sortedDirectories = [...directoryKeys].sort((a, b) =>
    a.localeCompare(b)
  );
  const collapsed: string[] = [];

  for (const candidate of sortedDirectories) {
    const candidatePrefix = directoryPrefix(candidate);
    const coveredByParent = collapsed.some((parent) =>
      candidatePrefix.startsWith(directoryPrefix(parent))
    );
    if (!coveredByParent) {
      collapsed.push(candidate);
    }
  }

  return collapsed;
}

function filterFilesCoveredByDirectories(
  fileKeys: readonly string[],
  directoryKeys: readonly string[],
): { remainingFileKeys: string[]; skippedCount: number } {
  if (directoryKeys.length === 0) {
    return { remainingFileKeys: [...fileKeys], skippedCount: 0 };
  }

  const directoryPrefixes = directoryKeys.map((key) => directoryPrefix(key));
  const remainingFileKeys = fileKeys.filter((fileKey) =>
    !directoryPrefixes.some((prefix) => fileKey.startsWith(prefix))
  );

  return {
    remainingFileKeys,
    skippedCount: fileKeys.length - remainingFileKeys.length,
  };
}

function parseQuota(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatActions(actions: Set<CdnAction>): string {
  if (actions.size === 0) {
    return "none";
  }
  return ["refresh", "preload"].filter((action) =>
    actions.has(action as CdnAction)
  ).join(",");
}

function getHeaderValue(
  headers: ResponseHeaders | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== needle || value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).join(",");
    }
    return String(value);
  }

  return undefined;
}

function resolveRequestId(
  bodyRequestId: string | undefined,
  headers: ResponseHeaders | undefined,
): string | undefined {
  return bodyRequestId ??
    getHeaderValue(headers, "x-acs-request-id") ??
    getHeaderValue(headers, "x-oss-request-id") ??
    getHeaderValue(headers, "x-oss-requestid") ??
    getHeaderValue(headers, "x-request-id");
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const record = error as Record<string, unknown>;
  const requestId = typeof record.requestId === "string"
    ? record.requestId
    : typeof record.data === "object" && record.data !== null
    ? ((record.data as Record<string, unknown>).RequestId ??
      (record.data as Record<string, unknown>).requestId) as
        | string
        | undefined
    : undefined;

  const details: string[] = [];
  if (typeof record.message === "string" && record.message !== "") {
    details.push(record.message);
  } else if (error instanceof Error && error.message !== "") {
    details.push(error.message);
  }
  if (typeof record.code === "string" && record.code !== "") {
    details.push(`code=${record.code}`);
  }
  if (typeof record.statusCode === "number") {
    details.push(`statusCode=${record.statusCode}`);
  }
  if (requestId) {
    details.push(`requestId=${requestId}`);
  }

  if (details.length > 0) {
    return details.join(", ");
  }

  return String(error);
}

function chunkByLimit(values: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function selectByQuota<T>(
  values: readonly T[],
  remainingQuota: number,
): QuotaSelection<T> {
  const safeQuota = remainingQuota > 0 ? remainingQuota : 0;
  const allowedCount = Math.min(values.length, safeQuota);
  const deniedCount = values.length - allowedCount;

  return {
    allowed: values.slice(0, allowedCount),
    deniedCount,
  };
}

function warnQuotaExhausted(
  label: "directory refresh" | "refresh" | "preload",
  requestedCount: number,
  quota: number,
  deniedCount: number,
): void {
  if (deniedCount <= 0) {
    return;
  }

  warning(
    `CDN ${label} quota exhausted: requested=${requestedCount}, quota=${quota}, skipped=${deniedCount}`,
  );
}

async function submitRefreshBatches(
  cdnClient: CdnClient,
  limiter: ApiRateLimiter,
  objectType: "File" | "Directory",
  urls: string[],
  securityToken: string | undefined,
): Promise<BatchSubmissionResult> {
  const taskIds: string[] = [];
  let submittedBatches = 0;
  let submittedUrls = 0;

  for (const batch of chunkByLimit(urls, CDN_MAX_URLS_PER_REQUEST)) {
    try {
      const response = await limiter.schedule(() =>
        cdnClient.refreshObjectCaches(
          new RefreshObjectCachesRequestCtor({
            objectPath: batch.join("\n"),
            objectType,
            securityToken,
          }),
        )
      );
      submittedBatches += 1;
      submittedUrls += batch.length;
      const requestId = resolveRequestId(
        response.body?.requestId,
        response.headers,
      );
      const statusCode = response.statusCode ?? "unknown";
      if (response.body?.refreshTaskId) {
        taskIds.push(response.body.refreshTaskId);
        info(
          `CDN refresh submitted: objectType=${objectType}, urls=${batch.length}, statusCode=${statusCode}, requestId=${
            requestId ?? "n/a"
          }, taskId=${response.body.refreshTaskId}`,
        );
      } else {
        warning(
          `CDN refresh response without task ID: objectType=${objectType}, urls=${batch.length}, statusCode=${statusCode}, requestId=${
            requestId ?? "n/a"
          }`,
        );
      }
    } catch (error: unknown) {
      warning(`CDN refresh batch failed: ${errorMessage(error)}`);
    }
  }

  return { taskIds, submittedBatches, submittedUrls };
}

async function submitPreloadBatches(
  cdnClient: CdnClient,
  limiter: ApiRateLimiter,
  urls: string[],
  securityToken: string | undefined,
): Promise<BatchSubmissionResult> {
  const taskIds: string[] = [];
  let submittedBatches = 0;
  let submittedUrls = 0;

  for (const batch of chunkByLimit(urls, CDN_MAX_URLS_PER_REQUEST)) {
    try {
      const response = await limiter.schedule(() =>
        cdnClient.pushObjectCache(
          new PushObjectCacheRequestCtor({
            objectPath: batch.join("\n"),
            securityToken,
          }),
        )
      );
      submittedBatches += 1;
      submittedUrls += batch.length;
      const requestId = resolveRequestId(
        response.body?.requestId,
        response.headers,
      );
      const statusCode = response.statusCode ?? "unknown";
      if (response.body?.pushTaskId) {
        taskIds.push(response.body.pushTaskId);
        info(
          `CDN preload submitted: urls=${batch.length}, statusCode=${statusCode}, requestId=${
            requestId ?? "n/a"
          }, taskId=${response.body.pushTaskId}`,
        );
      } else {
        warning(
          `CDN preload response without task ID: urls=${batch.length}, statusCode=${statusCode}, requestId=${
            requestId ?? "n/a"
          }`,
        );
      }
    } catch (error: unknown) {
      warning(`CDN preload batch failed: ${errorMessage(error)}`);
    }
  }

  return { taskIds, submittedBatches, submittedUrls };
}

async function runCdnActions(
  cdnClient: CdnClient,
  limiter: ApiRateLimiter,
  quotaLimiter: ApiRateLimiter,
  uploadedKeys: string[],
  inputs: Inputs,
  credentials: Credentials,
): Promise<{ refreshTaskIds: string[]; preloadTaskIds: string[] }> {
  const refreshTaskIds: string[] = [];
  const preloadTaskIds: string[] = [];

  let refreshRemain = 0;
  let directoryRefreshRemain = 0;
  let preloadRemain = 0;
  let refreshSubmissions = 0;
  let refreshSubmittedUrls = 0;
  let preloadSubmissions = 0;
  let preloadSubmittedUrls = 0;

  debug(
    `[main:runCdnActions] hasSecurityToken=${
      Boolean(credentials.securityToken)
    } uploadedKeys=${uploadedKeys.length}`,
  );

  try {
    const quota = await quotaLimiter.schedule(() =>
      cdnClient.describeRefreshQuota(
        new DescribeRefreshQuotaRequestCtor({
          securityToken: credentials.securityToken,
        }),
      )
    );
    refreshRemain = parseQuota(quota.body?.urlRemain);
    directoryRefreshRemain = parseQuota(quota.body?.dirRemain);
    preloadRemain = parseQuota(quota.body?.preloadRemain);
    const requestId = resolveRequestId(quota.body?.requestId, quota.headers);
    info(
      `CDN quota: statusCode=${quota.statusCode ?? "unknown"}, requestId=${
        requestId ?? "n/a"
      }, urlRemain=${refreshRemain}, dirRemain=${directoryRefreshRemain}, preloadRemain=${preloadRemain}`,
    );
  } catch (error: unknown) {
    warning(
      `CDN quota check failed, skipping CDN actions: ${errorMessage(error)}`,
    );
    return { refreshTaskIds: [], preloadTaskIds: [] };
  }

  const files = [...uploadedKeys].sort((a, b) => a.localeCompare(b));
  const discoveredDirectories = Array.from(
    new Set(
      files
        .map((key) => dirname(key).replace(/\\/g, "/").replace(/^\.$/, ""))
        .filter((value) => value !== ""),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const directories = collapseRecursiveDirectories(discoveredDirectories);
  const shouldRefresh = inputs.cdnActions.has("refresh");
  const shouldPreloadFiles = inputs.cdnActions.has("preload");

  const refreshFileSelection = shouldRefresh
    ? filterFilesCoveredByDirectories(files, directories)
    : { remainingFileKeys: files, skippedCount: 0 };
  const preloadFileSelection = { remainingFileKeys: files, skippedCount: 0 };

  const refreshFileKeys = refreshFileSelection.remainingFileKeys;
  const preloadFileKeys = preloadFileSelection.remainingFileKeys;
  info(
    `CDN plan: directoryUrls=${directories.length}, skippedNestedDirectories=${
      discoveredDirectories.length - directories.length
    }, refreshFileUrls=${refreshFileKeys.length}, preloadFileUrls=${preloadFileKeys.length}, skippedRefreshFilesByDirectory=${refreshFileSelection.skippedCount}, actions=${
      formatActions(inputs.cdnActions)
    }`,
  );

  // Alibaba Cloud recommendation: all RefreshObjectCaches first, then all
  // PushObjectCache. Purging stale content before preloading ensures POPs
  // always fetch the latest version from origin.
  if (shouldRefresh) {
    const directoryQuota = directoryRefreshRemain;
    const selection = selectByQuota(
      directories,
      directoryQuota,
    );
    directoryRefreshRemain -= selection.allowed.length;
    if (selection.allowed.length > 0) {
      const allowedDirectoryUrls = selection.allowed.map((key) =>
        buildDirectoryUrl(inputs.cdnBaseUrl, key)
      );
      info(
        `CDN refresh (Directory): submitting ${allowedDirectoryUrls.length} URL(s)`,
      );
      const result = await submitRefreshBatches(
        cdnClient,
        limiter,
        "Directory",
        allowedDirectoryUrls,
        credentials.securityToken,
      );
      refreshTaskIds.push(...result.taskIds);
      refreshSubmissions += result.submittedBatches;
      refreshSubmittedUrls += result.submittedUrls;
    }
    warnQuotaExhausted(
      "directory refresh",
      directories.length,
      directoryQuota,
      selection.deniedCount,
    );
  }

  if (shouldRefresh) {
    const refreshQuota = refreshRemain;
    const selection = selectByQuota(refreshFileKeys, refreshQuota);
    refreshRemain -= selection.allowed.length;
    if (selection.allowed.length > 0) {
      const allowedRefreshUrls = selection.allowed.map((key) =>
        buildFileUrl(inputs.cdnBaseUrl, key)
      );
      info(
        `CDN refresh (File): submitting ${allowedRefreshUrls.length} URL(s)`,
      );
      const result = await submitRefreshBatches(
        cdnClient,
        limiter,
        "File",
        allowedRefreshUrls,
        credentials.securityToken,
      );
      refreshTaskIds.push(...result.taskIds);
      refreshSubmissions += result.submittedBatches;
      refreshSubmittedUrls += result.submittedUrls;
    }
    warnQuotaExhausted(
      "refresh",
      refreshFileKeys.length,
      refreshQuota,
      selection.deniedCount,
    );
  }

  if (shouldPreloadFiles) {
    const preloadQuota = preloadRemain;
    const selection = selectByQuota(preloadFileKeys, preloadQuota);
    preloadRemain -= selection.allowed.length;
    if (selection.allowed.length > 0) {
      const allowedPreloadUrls = selection.allowed.map((key) =>
        buildFileUrl(inputs.cdnBaseUrl, key)
      );
      info(
        `CDN preload (File): submitting ${allowedPreloadUrls.length} URL(s)`,
      );
      const result = await submitPreloadBatches(
        cdnClient,
        limiter,
        allowedPreloadUrls,
        credentials.securityToken,
      );
      preloadTaskIds.push(...result.taskIds);
      preloadSubmissions += result.submittedBatches;
      preloadSubmittedUrls += result.submittedUrls;
    }
    warnQuotaExhausted(
      "preload",
      preloadFileKeys.length,
      preloadQuota,
      selection.deniedCount,
    );
  }

  const uniqueRefreshTaskIds = Array.from(new Set(refreshTaskIds));
  const uniquePreloadTaskIds = Array.from(new Set(preloadTaskIds));
  info(
    `CDN actions complete: refreshSubmissions=${refreshSubmissions}, refreshSubmittedUrls=${refreshSubmittedUrls}, refreshUniqueTasks=${uniqueRefreshTaskIds.length}, preloadSubmissions=${preloadSubmissions}, preloadSubmittedUrls=${preloadSubmittedUrls}, preloadUniqueTasks=${uniquePreloadTaskIds.length}`,
  );
  if (refreshSubmissions > uniqueRefreshTaskIds.length) {
    info(
      `CDN refresh note: duplicate task IDs detected (${refreshSubmissions} submissions for ${uniqueRefreshTaskIds.length} unique task IDs)`,
    );
  }
  if (preloadSubmissions > uniquePreloadTaskIds.length) {
    info(
      `CDN preload note: duplicate task IDs detected (${preloadSubmissions} submissions for ${uniquePreloadTaskIds.length} unique task IDs)`,
    );
  }
  if (uniqueRefreshTaskIds.length > 0) {
    info(`CDN refresh task IDs: ${uniqueRefreshTaskIds.join(",")}`);
  }
  if (uniquePreloadTaskIds.length > 0) {
    info(`CDN preload task IDs: ${uniquePreloadTaskIds.join(",")}`);
  }

  return {
    refreshTaskIds: uniqueRefreshTaskIds,
    preloadTaskIds: uniquePreloadTaskIds,
  };
}

async function writeSummary(
  inputs: Inputs,
  totalFiles: number,
  uploadResult: {
    uploadedCount: number;
    skippedCount: number;
    failedCount: number;
    failedFiles: UploadFailure[];
  },
  refreshTaskIds: string[],
  preloadTaskIds: string[],
): Promise<void> {
  const uploadTable: SummaryTableRow[] = [
    [{ data: "Metric", header: true }, { data: "Value", header: true }],
    ["Files uploaded", String(uploadResult.uploadedCount)],
    ["Files skipped (already exists)", String(uploadResult.skippedCount)],
    ["Files failed", String(uploadResult.failedCount)],
    ["Total files", String(totalFiles)],
    ["Bucket", inputs.bucket],
    ["Prefix", inputs.destinationPrefix || "(root)"],
  ];
  summary.addHeading("OSS Deployment", 2).addTable(uploadTable);

  if (uploadResult.failedFiles.length > 0) {
    const failureRows: SummaryTableRow[] = [
      [
        { data: "File", header: true },
        { data: "OSS Key", header: true },
        { data: "Error", header: true },
      ],
      ...uploadResult.failedFiles.map(({ relativePath, key, error }) => [
        relativePath,
        key,
        error,
      ]),
    ];
    summary.addHeading("Upload failures", 3).addTable(failureRows);
  }

  if (inputs.cdnEnabled && inputs.cdnActions.size > 0) {
    const cdnRows: SummaryTableRow[] = [
      [{ data: "Action", header: true }, { data: "Task IDs", header: true }],
    ];
    if (inputs.cdnActions.has("refresh")) {
      cdnRows.push([
        "Refresh",
        refreshTaskIds.length > 0 ? refreshTaskIds.join(", ") : "—",
      ]);
    }
    if (inputs.cdnActions.has("preload")) {
      cdnRows.push([
        "Preload",
        preloadTaskIds.length > 0 ? preloadTaskIds.join(", ") : "—",
      ]);
    }
    summary.addHeading("CDN", 3).addTable(cdnRows);
  }

  await summary.write();
}

export async function run(): Promise<void> {
  const inputs = parseInputs();
  const credentials = resolveCredentialsFromState() ??
    resolveCredentials();
  info(
    `CDN config: enabled=${inputs.cdnEnabled}, baseUrl=${
      inputs.cdnBaseUrl || "(empty)"
    }, actions=${formatActions(inputs.cdnActions)}`,
  );
  if (inputs.cdnEndpoint) {
    info(`CDN config: endpoint=${inputs.cdnEndpoint}`);
  }

  const ossLimiter = new ApiRateLimiter(inputs.apiRpsLimit);
  const cdnLimiter = new ApiRateLimiter(CDN_API_MAX_RPS);
  const cdnQuotaLimiter = new ApiRateLimiter(CDN_QUOTA_API_MAX_RPS);
  const ossClient = createOssClient(inputs, credentials);
  const cdnClient = inputs.cdnEnabled && inputs.cdnActions.size > 0
    ? createCdnClient(inputs, credentials)
    : undefined;

  const files = await collectFiles(inputs.inputDir);
  info(`Found ${files.length} file(s) in ${resolve(inputs.inputDir)}`);

  if (files.length === 0) {
    warning("No files to upload");
    setOutput("uploaded-count", "0");
    setOutput("skipped-count", "0");
    setOutput("failed-count", "0");
    setOutput("total-files", "0");
    setOutput("bucket", inputs.bucket);
    setOutput("destination-prefix", inputs.destinationPrefix);
    setOutput("cdn-refresh-task-ids", "");
    setOutput("cdn-preload-task-ids", "");
    saveState(STATE_CDN_REFRESH_TASK_IDS, "");
    saveState(STATE_CDN_PRELOAD_TASK_IDS, "");
    await writeSummary(
      inputs,
      0,
      { uploadedCount: 0, skippedCount: 0, failedCount: 0, failedFiles: [] },
      [],
      [],
    );
    return;
  }

  const uploadResult = await group(
    "Uploading files to OSS",
    () => uploadFiles(ossClient, ossLimiter, files, inputs),
  );
  info(
    `Upload summary before CDN: uploadedKeys=${uploadResult.uploadedKeys.length}, uploaded=${uploadResult.uploadedCount}, skipped=${uploadResult.skippedCount}`,
  );

  let refreshTaskIds: string[] = [];
  let preloadTaskIds: string[] = [];

  if (cdnClient && uploadResult.uploadedKeys.length > 0) {
    const client = cdnClient;
    try {
      const cdnResult = await group(
        "Running CDN actions",
        () =>
          runCdnActions(
            client,
            cdnLimiter,
            cdnQuotaLimiter,
            uploadResult.uploadedKeys,
            inputs,
            credentials,
          ),
      );
      refreshTaskIds = cdnResult.refreshTaskIds;
      preloadTaskIds = cdnResult.preloadTaskIds;
    } catch (error: unknown) {
      warning(`CDN actions failed: ${errorMessage(error)}`);
    }
  } else if (!cdnClient) {
    info(
      "CDN actions skipped: client not created (cdn-enabled=false or no CDN action configured)",
    );
  } else {
    info("CDN actions skipped: no uploaded files in this execution");
  }

  setOutput("uploaded-count", String(uploadResult.uploadedCount));
  setOutput("skipped-count", String(uploadResult.skippedCount));
  setOutput("failed-count", String(uploadResult.failedCount));
  setOutput("total-files", String(files.length));
  setOutput("bucket", inputs.bucket);
  setOutput("destination-prefix", inputs.destinationPrefix);
  setOutput("cdn-refresh-task-ids", refreshTaskIds.join(","));
  setOutput("cdn-preload-task-ids", preloadTaskIds.join(","));
  saveState(STATE_CDN_REFRESH_TASK_IDS, refreshTaskIds.join(","));
  saveState(STATE_CDN_PRELOAD_TASK_IDS, preloadTaskIds.join(","));

  if (uploadResult.failedCount > 0) {
    warning(
      `${uploadResult.failedCount} of ${files.length} file(s) failed to upload. ` +
        `The workflow continues with the ${uploadResult.uploadedCount} successfully uploaded file(s). ` +
        `See the summary for the full list of failures.`,
    );
  }

  await writeSummary(
    inputs,
    files.length,
    uploadResult,
    refreshTaskIds,
    preloadTaskIds,
  );
  info(
    `Deployment complete: uploaded=${uploadResult.uploadedCount}, skipped=${uploadResult.skippedCount}, failed=${uploadResult.failedCount}, total=${files.length}`,
  );
}

run().catch((error: unknown) => {
  if (error instanceof Error) {
    setFailed(error.message);
    return;
  }
  setFailed(String(error));
});
