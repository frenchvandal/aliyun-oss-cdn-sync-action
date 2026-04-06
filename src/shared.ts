import { lstat, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { AnnotationProperties } from "npm/actions-core";
import {
  getBooleanInput as getInputBoolean,
  getInput,
  getState,
  isDebug,
  notice,
} from "npm/actions-core";

import {
  STATE_ACCESS_KEY_ID,
  STATE_ACCESS_KEY_SECRET,
  STATE_SECURITY_TOKEN,
} from "./constants.ts";
export { ApiRateLimiter } from "./_api-rate-limiter.ts";
import { debug } from "./logger.ts";
import {
  buildObjectKey,
  parsePositiveIntegerValue,
  parsePrefix,
} from "./_shared-utils.ts";
export {
  buildFileUrl,
  buildObjectKey,
  errorMessage,
  parsePositiveIntegerValue,
  parsePrefix,
  parseQuota,
  resolveOssEndpoint,
  selectByQuota,
  toHost,
} from "./_shared-utils.ts";
export type { QuotaSelection } from "./_shared-utils.ts";

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
  return parsePositiveIntegerValue(
    name,
    getOptionalInput(name),
    defaultValue,
    max,
  );
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

export function requireCredentialsFromState(): Credentials {
  const credentials = resolveCredentialsFromState();
  if (credentials) {
    return credentials;
  }

  throw new Error(
    "Missing OIDC credentials in action state. This action authenticates only through the pre step using GitHub OIDC and an Aliyun RAM role.",
  );
}

export function emitDebugNotice(
  title: string,
  message: string,
  properties?: AnnotationProperties,
): void {
  if (!isDebug()) {
    return;
  }

  notice(message, properties ? { title, ...properties } : { title });
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
