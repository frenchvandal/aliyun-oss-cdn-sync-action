import { lstat, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  debug,
  getBooleanInput as getInputBoolean,
  getInput,
  getState,
} from "@actions/core";

import {
  STATE_ACCESS_KEY_ID,
  STATE_ACCESS_KEY_SECRET,
  STATE_SECURITY_TOKEN,
} from "./constants.ts";

export interface FileEntry {
  absolutePath: string;
  relativePath: string;
}

export interface Credentials {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string | undefined;
}

export interface OssBaseInputs {
  inputDir: string;
  bucket: string;
  region: string;
  destinationPrefix: string;
  endpoint: string | undefined;
  maxConcurrency: number;
  apiRpsLimit: number;
  sdkTimeoutMs: number;
}

export class ApiRateLimiter {
  private chain: Promise<void> = Promise.resolve();
  private readonly intervalMs: number;

  constructor(limitPerSecond: number) {
    this.intervalMs = Math.max(1, Math.ceil(1000 / limitPerSecond));
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    // Run fn() as soon as the chain resolves — no unnecessary pre-call delay.
    const next = this.chain.then(() => fn());

    // After fn() settles (success or failure), enforce the rate-limit interval
    // before the next scheduled call runs. Errors are caught here so that a
    // failed call does not stall subsequent ones; they still propagate to the
    // original caller via the returned `next` promise.
    this.chain = next.then(
      () =>
        new Promise<void>((resolve) => setTimeout(resolve, this.intervalMs)),
      () =>
        new Promise<void>((resolve) => setTimeout(resolve, this.intervalMs)),
    );

    return next;
  }
}

export function getOptionalInput(name: string): string | undefined {
  const value = getInput(name, { required: false }).trim();
  return value === "" ? undefined : value;
}

export function parseBooleanInput(
  name: string,
  defaultValue: boolean,
): boolean {
  if (getOptionalInput(name) === undefined) {
    return defaultValue;
  }

  try {
    return getInputBoolean(name, { required: true });
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      throw new Error(`'${name}' must be either 'true' or 'false'`);
    }
    throw error;
  }
}

export function parsePositiveIntegerInput(
  name: string,
  defaultValue: number,
  max?: number,
): number {
  const value = getOptionalInput(name);
  if (value === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`'${name}' must be a positive integer`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`'${name}' must be a positive integer`);
  }

  if (max !== undefined && parsed > max) {
    throw new Error(`'${name}' must be <= ${max}`);
  }

  return parsed;
}

export function parsePrefix(prefix: string | undefined): string {
  if (!prefix) {
    return "";
  }

  return prefix.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function parseOssBaseInputs(): OssBaseInputs {
  const inputDir = getOptionalInput("input-dir") ?? "_site";
  const bucket = getInput("bucket", { required: true }).trim();
  const region = getInput("region", { required: true }).trim();

  if (!bucket || !region) {
    throw new Error("'bucket' and 'region' are required");
  }

  return {
    inputDir,
    bucket,
    region,
    destinationPrefix: parsePrefix(getOptionalInput("destination-prefix")),
    endpoint: getOptionalInput("endpoint"),
    maxConcurrency: parsePositiveIntegerInput("max-concurrency", 5),
    apiRpsLimit: parsePositiveIntegerInput("api-rps-limit", 9000, 10000),
    sdkTimeoutMs: parsePositiveIntegerInput("sdk-timeout-ms", 60000),
  };
}

// Reads the OIDC-resolved credential saved by the pre step via saveState().
// Returns undefined if the pre step did not run or did not save credentials.
export function resolveCredentialsFromState(): Credentials | undefined {
  const accessKeyId = getState(STATE_ACCESS_KEY_ID);
  const accessKeySecret = getState(STATE_ACCESS_KEY_SECRET);
  if (!accessKeyId || !accessKeySecret) {
    return undefined;
  }
  const securityToken = getState(STATE_SECURITY_TOKEN);
  debug(
    `[resolveCredentialsFromState] source=state hasSecurityToken=${
      Boolean(securityToken)
    }`,
  );
  return {
    accessKeyId,
    accessKeySecret,
    securityToken: securityToken || undefined,
  };
}

export function resolveCredentials(): Credentials {
  throw new Error(
    "Missing OIDC credentials in action state. This action authenticates only through the pre step using GitHub OIDC and an Alibaba Cloud RAM role.",
  );
}

export function toHost(endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) {
    return new URL(endpoint).host;
  }

  return endpoint;
}

export function resolveOssEndpoint(
  region: string,
  endpoint: string | undefined,
): string {
  if (endpoint) {
    try {
      return toHost(endpoint);
    } catch {
      throw new Error(
        `'endpoint' is not a valid URL or hostname: ${endpoint}`,
      );
    }
  }

  if (region.includes(".")) {
    return region;
  }

  return `${region}.aliyuncs.com`;
}

export function buildObjectKey(prefix: string, relativePath: string): string {
  return prefix === "" ? relativePath : `${prefix}/${relativePath}`;
}

export async function collectFiles(
  rootDirectory: string,
): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  const rootAbsolutePath = resolve(rootDirectory);

  const rootStat = await lstat(rootAbsolutePath);
  if (!rootStat.isDirectory()) {
    throw new Error(
      `'input-dir' must point to a directory: ${rootAbsolutePath}`,
    );
  }

  async function walk(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      files.push({
        absolutePath,
        relativePath: relative(rootAbsolutePath, absolutePath).replace(
          /\\/g,
          "/",
        ),
      });
    }
  }

  await walk(rootAbsolutePath);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

export function buildFileUrl(baseUrl: string, key: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(key.replace(/^\/+/, ""), base).toString();
}

export async function collectLocalObjectKeys(
  inputDir: string,
  prefix: string,
): Promise<Set<string>> {
  const files = await collectFiles(inputDir);
  const keys = new Set<string>();

  for (const file of files) {
    keys.add(buildObjectKey(prefix, file.relativePath));
  }

  return keys;
}
