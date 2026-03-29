import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import * as cache from "npm/actions-cache";
import { getState, saveState } from "npm/actions-core";

import { STATE_CACHE_RESTORED_KEY, STATE_MAIN_COMPLETED } from "./constants.ts";
import { info, success, warning } from "./logger.ts";
import {
  collectFiles,
  errorMessage,
  getOptionalInput,
  parseBooleanInput,
} from "./shared.ts";

const LOCAL_CACHE_DIRECTORY = "_cache";

function parseRestoreKeys(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function getCachePath(): string {
  return resolve(LOCAL_CACHE_DIRECTORY);
}

export async function restoreLocalCache(): Promise<void> {
  if (!parseBooleanInput("cache-enabled", true)) {
    info("Skipping local _cache restore because cache-enabled is false.");
    saveState(STATE_CACHE_RESTORED_KEY, "");
    return;
  }

  const primaryKey = getOptionalInput("cache-key");
  if (!primaryKey) {
    return;
  }

  const cachePath = getCachePath();
  const restoreKeys = parseRestoreKeys(getOptionalInput("cache-restore-keys"));

  await mkdir(cachePath, { recursive: true });

  try {
    const restoredKey = await cache.restoreCache(
      [cachePath],
      primaryKey,
      restoreKeys,
    );
    saveState(STATE_CACHE_RESTORED_KEY, restoredKey ?? "");

    if (restoredKey) {
      success(`Local _cache restored from key: ${restoredKey}`);
      return;
    }

    info(
      `Local _cache not found for input keys: ${
        [
          primaryKey,
          ...restoreKeys,
        ].join(", ")
      }`,
    );
  } catch (error: unknown) {
    warning(`Local _cache restore skipped: ${errorMessage(error)}`);
    saveState(STATE_CACHE_RESTORED_KEY, "");
  }
}

export async function saveLocalCache(): Promise<void> {
  // Re-read the input in post instead of reusing the pre-step key from state:
  // expressions such as hashFiles(...) may resolve differently after checkout
  // and build steps have populated the workspace.
  const primaryKey = getOptionalInput("cache-key");
  if (!primaryKey) {
    info("Skipping local _cache save because cache-key is not set.");
    return;
  }

  if (getState(STATE_MAIN_COMPLETED) !== "true") {
    info("Skipping local _cache save because the main step did not complete.");
    return;
  }

  const restoredKey = getState(STATE_CACHE_RESTORED_KEY);
  if (restoredKey !== "" && restoredKey === primaryKey) {
    info(
      `Local _cache hit occurred on the primary key ${primaryKey}, not saving cache.`,
    );
    return;
  }

  const cachePath = getCachePath();

  try {
    const files = await collectFiles(cachePath);
    if (files.length === 0) {
      info("Skipping local _cache save because _cache contains no files.");
      return;
    }
  } catch (error: unknown) {
    warning(`Local _cache save skipped: ${errorMessage(error)}`);
    return;
  }

  try {
    info(`Attempting local _cache save with key: ${primaryKey}`);
    const cacheId = await cache.saveCache([cachePath], primaryKey);
    if (cacheId !== -1) {
      success(`Local _cache saved with key: ${primaryKey}`);
      return;
    }
    info(
      `Local _cache was not saved because no cache entry was created for key: ${primaryKey}`,
    );
  } catch (error: unknown) {
    warning(`Local _cache save skipped: ${errorMessage(error)}`);
  }
}
