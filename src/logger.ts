import { isDebug, setFailed, warning as emitWarning } from "npm/actions-core";
import { createLogger } from "npm/ernest-logger";
import type { Logger, LoggerOptions } from "npm/ernest-logger";

const ACTION_LOG_PREFIX = "[Aliyun OSS CDN]";

export const actionLogger = createLogger({
  colorize: true,
  emoji: true,
  level: isDebug() ? "debug" : "info",
  prefix: ACTION_LOG_PREFIX,
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
  emitWarning(`${ACTION_LOG_PREFIX} ${message}`);
}

export function fail(message: string): void {
  setFailed(`${ACTION_LOG_PREFIX} ${message}`);
}
