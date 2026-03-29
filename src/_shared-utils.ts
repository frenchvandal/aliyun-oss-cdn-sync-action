export type QuotaSelection<T> = {
  allowed: T[];
  deniedCount: number;
};

export function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const record = error as Record<string, unknown>;
  const dataRecord = typeof record.data === "object" && record.data !== null
    ? record.data as Record<string, unknown>
    : undefined;
  const requestId = typeof record.requestId === "string"
    ? record.requestId
    : typeof dataRecord?.RequestId === "string"
    ? dataRecord.RequestId
    : typeof dataRecord?.requestId === "string"
    ? dataRecord.requestId
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

export function parsePositiveIntegerValue(
  name: string,
  value: string | undefined,
  defaultValue: number,
  max?: number,
): number {
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

export function parseQuota(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function selectByQuota<T>(
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

export function buildFileUrl(baseUrl: string, key: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(key.replace(/^\/+/, ""), base).toString();
}
