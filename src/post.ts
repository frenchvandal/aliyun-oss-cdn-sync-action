import { debug, getState, group, info, summary, warning } from "@actions/core";
type SummaryTableRow = Array<{ data: string; header?: boolean } | string>;
import * as Cdn from "@alicloud/cdn20180510";
import * as AliOssModule from "ali-oss";

import {
  ApiRateLimiter,
  buildFileUrl,
  collectLocalObjectKeys,
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

type OSSClient = {
  list(query: {
    prefix?: string;
    "max-keys"?: number;
    marker?: string;
  }): Promise<{
    objects: Array<{ name: string }> | null;
    isTruncated: boolean;
    nextMarker: string;
  }>;
  delete(key: string): Promise<unknown>;
};

type CdnClient = {
  describeRefreshQuota(
    request: unknown,
  ): Promise<{ body?: { requestId?: string; urlRemain?: string } }>;
  refreshObjectCaches(
    request: unknown,
  ): Promise<{ body?: { requestId?: string; refreshTaskId?: string } }>;
  describeRefreshTaskById(
    request: unknown,
  ): Promise<{
    statusCode?: number;
    headers?: Record<string, unknown>;
    body?: {
      requestId?: string;
      tasks?: Array<{
        taskId?: string;
        status?: string;
        process?: string;
        objectType?: string;
        objectPath?: string;
        creationTime?: string;
        description?: string;
      }>;
    };
  }>;
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
const DescribeRefreshTaskByIdRequestCtor = Cdn
  .DescribeRefreshTaskByIdRequest as unknown as new (
    map?: Record<string, unknown>,
  ) => unknown;
const RefreshObjectCachesRequestCtor = Cdn
  .RefreshObjectCachesRequest as unknown as new (
    map?: Record<string, unknown>,
  ) => unknown;

// Alibaba Cloud CDN API accepts at most 100 URLs per refresh/preload request.
const CDN_MAX_URLS_PER_REQUEST = 100;
// RefreshObjectCaches: 50 req/s.
const CDN_API_MAX_RPS = 50;
// DescribeRefreshQuota: 20 req/s (stricter endpoint).
const CDN_QUOTA_API_MAX_RPS = 20;

type CdnTaskLookupEntry = {
  source: string;
  taskId: string;
  status: string;
  progress: string;
  objectType: string;
  createdAt: string;
  objectPath: string;
  detail: string;
};
type QuotaSelection<T> = {
  allowed: T[];
  deniedCount: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseQuota(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
  requestedCount: number,
  quota: number,
  deniedCount: number,
): void {
  if (deniedCount <= 0) {
    return;
  }

  warning(
    `CDN refresh quota exhausted for deleted objects: requested=${requestedCount}, quota=${quota}, skipped=${deniedCount}`,
  );
}

function parseTaskIdList(raw: string): string[] {
  if (raw.trim() === "") {
    return [];
  }
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== ""),
    ),
  );
}

function formatTaskSources(
  refreshTaskIds: readonly string[],
  preloadTaskIds: readonly string[],
): Map<string, string> {
  const taskSources = new Map<string, string>();
  for (const taskId of refreshTaskIds) {
    taskSources.set(taskId, "Refresh");
  }
  for (const taskId of preloadTaskIds) {
    const previousSource = taskSources.get(taskId);
    taskSources.set(taskId, previousSource ? "Refresh+Preload" : "Preload");
  }
  return taskSources;
}

function displayValue(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

async function describeMainCdnTasks(
  cdnClient: CdnClient,
  limiter: ApiRateLimiter,
  taskSources: ReadonlyMap<string, string>,
  securityToken: string | undefined,
): Promise<{
  rows: CdnTaskLookupEntry[];
  lookupFailures: number;
}> {
  const rows: CdnTaskLookupEntry[] = [];
  let lookupFailures = 0;
  const taskIds = [...taskSources.keys()].sort((a, b) => a.localeCompare(b));

  for (const taskId of taskIds) {
    const source = taskSources.get(taskId) ?? "Unknown";
    try {
      const response = await limiter.schedule(() =>
        cdnClient.describeRefreshTaskById(
          new DescribeRefreshTaskByIdRequestCtor({
            taskId,
            securityToken,
          }),
        )
      );

      const tasks = response.body?.tasks ?? [];
      if (tasks.length === 0) {
        rows.push({
          source,
          taskId,
          status: "NotFound",
          progress: "n/a",
          objectType: "n/a",
          createdAt: "n/a",
          objectPath: "n/a",
          detail: "No task details returned by DescribeRefreshTaskById.",
        });
        continue;
      }

      for (const task of tasks) {
        rows.push({
          source,
          taskId: displayValue(task.taskId, taskId),
          status: displayValue(task.status, "unknown"),
          progress: displayValue(task.process, "n/a"),
          objectType: displayValue(task.objectType, "unknown"),
          createdAt: displayValue(task.creationTime, "n/a"),
          objectPath: displayValue(task.objectPath, "n/a"),
          detail: displayValue(task.description, "—"),
        });
      }
    } catch (error: unknown) {
      lookupFailures += 1;
      const message = errorMessage(error);
      warning(
        `CDN task status lookup failed for taskId=${taskId}: ${message}`,
      );
      rows.push({
        source,
        taskId,
        status: "LookupFailed",
        progress: "n/a",
        objectType: "n/a",
        createdAt: "n/a",
        objectPath: "n/a",
        detail: message,
      });
    }
  }

  return { rows, lookupFailures };
}

function createOssClient(
  inputs: ReturnType<typeof parseOssBaseInputs>,
  credentials: ReturnType<typeof resolveCredentials>,
  oidcInputs: OidcInputs,
): OSSClient {
  const authType = credentials.securityToken ? "sts" : "access_key";
  debug(
    `[post:createOssClient] authType=${authType} hasSecurityToken=${
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
      const refreshed = await resolveOidcCredential(oidcInputs);
      return {
        accessKeyId: refreshed.accessKeyId,
        accessKeySecret: refreshed.accessKeySecret,
        stsToken: refreshed.securityToken,
      };
    };
    clientConfig.refreshSTSTokenInterval = oidcInputs.refreshStsTokenIntervalMs;
  }

  return new OssClientCtor(clientConfig);
}

async function listRemoteKeys(
  client: OSSClient,
  limiter: ApiRateLimiter,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let marker: string | undefined;

  while (true) {
    const query: {
      prefix?: string;
      "max-keys"?: number;
      marker?: string;
    } = {
      "max-keys": 1000,
    };

    if (prefix !== "") {
      // Scope the post step cleanup strictly to objects inside the target
      // directory prefix.
      query.prefix = `${prefix}/`;
    }

    if (marker) {
      query.marker = marker;
    }

    const response = await limiter.schedule(() => client.list(query));

    for (const item of response.objects ?? []) {
      if (item.name) {
        keys.push(item.name);
      }
    }

    if (!response.isTruncated || !response.nextMarker) {
      break;
    }

    marker = response.nextMarker;
  }

  return keys;
}

async function deleteOrphans(
  client: OSSClient,
  limiter: ApiRateLimiter,
  localKeys: Set<string>,
  remoteKeys: string[],
): Promise<{ deleted: number; deletedKeys: string[] }> {
  const orphans = remoteKeys.filter((key) => !localKeys.has(key));
  if (orphans.length === 0) {
    return { deleted: 0, deletedKeys: [] };
  }

  const deleteResults = await Promise.allSettled(
    orphans.map((key) => limiter.schedule(() => client.delete(key))),
  );

  let deleted = 0;
  const deletedKeys: string[] = [];
  for (const [index, result] of deleteResults.entries()) {
    const key = orphans[index];
    if (!key) {
      continue;
    }

    if (result.status === "fulfilled") {
      deleted += 1;
      deletedKeys.push(key);
      info(`Deleted orphan OSS object: ${key}`);
      continue;
    }

    warning(
      `Failed to delete orphan OSS object: ${key} (${
        errorMessage(result.reason)
      })`,
    );
  }

  return { deleted, deletedKeys };
}

async function refreshDeletedCdnObjects(
  cdnClient: CdnClient,
  limiter: ApiRateLimiter,
  quotaLimiter: ApiRateLimiter,
  deletedKeys: string[],
  cdnBaseUrl: string,
  securityToken: string | undefined,
): Promise<void> {
  // Check available refresh quota before submitting.
  let urlRemain = 0;
  try {
    const quota = await quotaLimiter.schedule(() =>
      cdnClient.describeRefreshQuota(
        new DescribeRefreshQuotaRequestCtor({ securityToken }),
      )
    );
    urlRemain = parseQuota(quota.body?.urlRemain);
    info(
      `CDN quota for post step cleanup: urlRemain=${urlRemain}, requested=${deletedKeys.length}`,
    );
  } catch (error: unknown) {
    warning(
      `CDN quota check failed, skipping CDN refresh: ${errorMessage(error)}`,
    );
    return;
  }

  const selection = selectByQuota(deletedKeys, urlRemain);
  warnQuotaExhausted(
    deletedKeys.length,
    urlRemain,
    selection.deniedCount,
  );

  if (selection.allowed.length === 0) {
    return;
  }

  const allowedUrls = selection.allowed.map((key) =>
    buildFileUrl(cdnBaseUrl, key)
  );
  info(
    `CDN refresh (post step cleanup): submitting ${allowedUrls.length} deleted URL(s)`,
  );

  for (const batch of chunkByLimit(allowedUrls, CDN_MAX_URLS_PER_REQUEST)) {
    try {
      const response = await limiter.schedule(() =>
        cdnClient.refreshObjectCaches(
          new RefreshObjectCachesRequestCtor({
            objectPath: batch.join("\n"),
            objectType: "File",
            securityToken,
          }),
        )
      );
      if (response.body?.refreshTaskId) {
        info(
          `CDN refresh submitted: urls=${batch.length}, taskId=${response.body.refreshTaskId}`,
        );
      } else {
        warning(
          `CDN refresh batch returned no task ID: urls=${batch.length}`,
        );
      }
    } catch (error: unknown) {
      warning(`CDN refresh batch failed: ${errorMessage(error)}`);
    }
  }
}

async function runPost(): Promise<void> {
  const oidcInputs = parseOidcInputs();
  const inputs = parseOssBaseInputs();

  // Credentials are resolved only through OIDC in the pre step.
  const credentials = resolveCredentialsFromState() ??
    resolveCredentials();
  debug(
    `[post:runPost] hasSecurityToken=${
      Boolean(credentials.securityToken)
    } bucket=${inputs.bucket} prefix='${inputs.destinationPrefix}'`,
  );

  const cdnEnabled = parseBooleanInput("cdn-enabled", false);
  const cdnBaseUrlInput = getOptionalInput("cdn-base-url");
  const cdnBaseUrl = cdnBaseUrlInput ?? "";
  const cdnEndpoint = getOptionalInput("cdn-endpoint");
  const mainRefreshTaskIdsRaw = getState(STATE_CDN_REFRESH_TASK_IDS);
  const mainPreloadTaskIdsRaw = getState(STATE_CDN_PRELOAD_TASK_IDS);
  const mainRefreshTaskIds = parseTaskIdList(mainRefreshTaskIdsRaw);
  const mainPreloadTaskIds = parseTaskIdList(mainPreloadTaskIdsRaw);
  const mainTaskSources = formatTaskSources(
    mainRefreshTaskIds,
    mainPreloadTaskIds,
  );
  debug(
    `[post:taskState] refreshRawLength=${mainRefreshTaskIdsRaw.length} preloadRawLength=${mainPreloadTaskIdsRaw.length}`,
  );
  info(
    `CDN task IDs from main step (refresh): ${
      mainRefreshTaskIds.length > 0 ? mainRefreshTaskIds.join(",") : "none"
    }`,
  );
  info(
    `CDN task IDs from main step (preload): ${
      mainPreloadTaskIds.length > 0 ? mainPreloadTaskIds.join(",") : "none"
    }`,
  );
  info(
    `CDN task status plan: refreshTaskIds=${mainRefreshTaskIds.length}, preloadTaskIds=${mainPreloadTaskIds.length}, uniqueTaskIds=${mainTaskSources.size}`,
  );

  const ossLimiter = new ApiRateLimiter(inputs.apiRpsLimit);
  const client = createOssClient(inputs, credentials, oidcInputs);

  const localKeys = await collectLocalObjectKeys(
    inputs.inputDir,
    inputs.destinationPrefix,
  );

  const { deleted, deletedKeys, remoteCount } = await group(
    "Comparing local and remote objects",
    async () => {
      const remoteKeys = await listRemoteKeys(
        client,
        ossLimiter,
        inputs.destinationPrefix,
      );
      info(
        `Cleanup comparison: local=${localKeys.size}, remote=${remoteKeys.length}, prefix='${inputs.destinationPrefix}'`,
      );
      const result = await deleteOrphans(
        client,
        ossLimiter,
        localKeys,
        remoteKeys,
      );
      info(`Cleanup complete: deleted=${result.deleted}`);
      return { ...result, remoteCount: remoteKeys.length };
    },
  );

  const shouldRefreshDeletedObjects = cdnEnabled && cdnBaseUrl !== "" &&
    deletedKeys.length > 0;
  const shouldLookupMainTasks = mainTaskSources.size > 0;
  if (!shouldLookupMainTasks) {
    info(
      "CDN task status lookup skipped: no task IDs were received from the main step.",
    );
  }

  let cdnTaskStatusRows: CdnTaskLookupEntry[] = [];
  let cdnTaskLookupFailures = 0;

  if (cdnEnabled && deletedKeys.length > 0 && cdnBaseUrl === "") {
    warning(
      "CDN refresh skipped for deleted objects: 'cdn-base-url' is not set",
    );
  }

  if (shouldRefreshDeletedObjects || shouldLookupMainTasks) {
    const cdnLimiter = new ApiRateLimiter(CDN_API_MAX_RPS);
    const cdnQuotaLimiter = new ApiRateLimiter(CDN_QUOTA_API_MAX_RPS);
    const cdnLookupLimiter = new ApiRateLimiter(CDN_QUOTA_API_MAX_RPS);
    const cdnClient = new CdnClientCtor({
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      securityToken: credentials.securityToken,
      // Alibaba Cloud CDN is a global service; regionId is required by the Tea
      // SDK for internal endpoint resolution but has no effect on routing.
      // Strip the OSS-specific "oss-" prefix to derive a Tea-compatible region.
      regionId: inputs.region.replace(/^oss-/, ""),
      endpoint: cdnEndpoint,
      protocol: "HTTPS",
      readTimeout: inputs.sdkTimeoutMs,
      connectTimeout: inputs.sdkTimeoutMs,
    });

    if (shouldRefreshDeletedObjects) {
      try {
        await group(
          "Refreshing CDN for deleted objects",
          () =>
            refreshDeletedCdnObjects(
              cdnClient,
              cdnLimiter,
              cdnQuotaLimiter,
              deletedKeys,
              cdnBaseUrl,
              credentials.securityToken,
            ),
        );
      } catch (error: unknown) {
        warning(
          `CDN refresh for deleted objects failed: ${errorMessage(error)}`,
        );
      }
    }

    if (shouldLookupMainTasks) {
      try {
        const taskReport = await group(
          "Retrieving CDN task status from main step",
          () =>
            describeMainCdnTasks(
              cdnClient,
              cdnLookupLimiter,
              mainTaskSources,
              credentials.securityToken,
            ),
        );
        cdnTaskStatusRows = taskReport.rows;
        cdnTaskLookupFailures = taskReport.lookupFailures;
      } catch (error: unknown) {
        warning(
          `CDN task status reporting failed: ${errorMessage(error)}`,
        );
      }
    }
  }

  const postTable: SummaryTableRow[] = [
    [{ data: "Metric", header: true }, { data: "Value", header: true }],
    ["Remote objects scanned", String(remoteCount)],
    ["Orphan objects deleted", String(deleted)],
  ];
  if (shouldLookupMainTasks) {
    postTable.push([
      "Main CDN task IDs (from main step)",
      String(mainTaskSources.size),
    ]);
    postTable.push([
      "Main CDN task lookup failures",
      String(cdnTaskLookupFailures),
    ]);
  }

  summary.addHeading("OSS Cleanup", 2).addTable(postTable);
  if (shouldLookupMainTasks) {
    const taskTable: SummaryTableRow[] = [
      [
        { data: "Source", header: true },
        { data: "Task ID", header: true },
        { data: "Status", header: true },
        { data: "Progress", header: true },
        { data: "Type", header: true },
        { data: "Created (UTC)", header: true },
        { data: "Object Path", header: true },
        { data: "Detail", header: true },
      ],
    ];
    if (cdnTaskStatusRows.length > 0) {
      taskTable.push(
        ...cdnTaskStatusRows.map((entry) => [
          entry.source,
          entry.taskId,
          entry.status,
          entry.progress,
          entry.objectType,
          entry.createdAt,
          entry.objectPath,
          entry.detail,
        ]),
      );
    } else {
      taskTable.push([
        "n/a",
        "n/a",
        "Unavailable",
        "n/a",
        "n/a",
        "n/a",
        "n/a",
        "Task lookup did not return any rows.",
      ]);
    }
    summary.addHeading("CDN Task Status (informational)", 3).addTable(
      taskTable,
    );
  }
  await summary.write();
}

runPost().catch((error: unknown) => {
  warning(
    error instanceof Error
      ? `Post step failed: ${error.message}`
      : `Post step failed: ${String(error)}`,
  );
});
