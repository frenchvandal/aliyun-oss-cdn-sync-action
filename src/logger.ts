import process from "node:process";

import { isDebug } from "npm/actions-core";
import { createLogger } from "npm/ernest-logger";
import type { Logger, LoggerOptions } from "npm/ernest-logger";

export const actionLogger = createLogger({
  colorize: true,
  emoji: true,
  level: isDebug() ? "debug" : "info",
  prefix: "[Aliyun OSS CDN]",
  time: true,
});

export function configureLogger(options: Partial<LoggerOptions>): Logger {
  return actionLogger.configure(options);
}

export function debug(message: string): void {
  actionLogger.debug(message);
}

export function info(message: string): void {
  actionLogger.info(message);
}

export function start(message: string): void {
  actionLogger.start(message);
}

export function success(message: string): void {
  actionLogger.success(message);
}

export function network(message: string): void {
  actionLogger.network(message);
}

export function warning(message: string): void {
  actionLogger.warn(message);
}

export function fail(message: string): void {
  actionLogger.fatal(message);
  process.exitCode = 1;
}
