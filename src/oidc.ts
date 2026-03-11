import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import process from "node:process";

import { debug, getIDToken, getInput, group, isDebug } from "@actions/core";
import CredentialClient, { Config } from "@alicloud/credentials";

export interface OidcInputs {
  audience: string;
  oidcProviderArn: string;
  refreshStsTokenIntervalMs: number;
  roleOidcArn: string;
  roleSessionExpiration: number;
  roleSessionName: string;
}

export interface OidcCredential {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
}

interface ResolveOidcCredentialOptions {
  debugGitHubIdTokenClaims?: boolean;
}

const DEFAULT_ROLE_SESSION_EXPIRATION = 900;
const DEFAULT_ROLE_SESSION_NAME = "github-action-session";
const DEFAULT_STS_REFRESH_INTERVAL_SECONDS = 300;
const MAX_ROLE_SESSION_EXPIRATION = 43200;
const MIN_ROLE_SESSION_EXPIRATION = 900;

type CredentialClientInstance = {
  getCredential(): Promise<Partial<OidcCredential>>;
};

type CredentialClientConstructor = new (
  config?: Config | null,
  provider?: unknown,
) => CredentialClientInstance;

// @alicloud/credentials default export typing is not constructable in Deno.
const CredentialClientCtor =
  CredentialClient as unknown as CredentialClientConstructor;

function decodeJwtPayload(
  idToken: string,
): Record<string, unknown> | undefined {
  const parts = idToken.split(".");
  const encodedPayload = parts[1];
  if (!encodedPayload) {
    return undefined;
  }

  const paddedPayload = encodedPayload.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");

  try {
    const payloadJson = atob(paddedPayload);
    const payload = JSON.parse(payloadJson) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return undefined;
    }
    return payload as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function debugGitHubIdTokenClaims(idToken: string): void {
  const decodedPayload = decodeJwtPayload(idToken);
  if (!decodedPayload) {
    debug("GitHub OIDC token payload decode failed");
    return;
  }

  const formattedPayload = JSON.stringify(decodedPayload, null, 2);
  debug(`GitHub OIDC token payload (decoded):\n${formattedPayload}`);
}

function getRequiredInput(name: string): string {
  return getInput(name, { required: true }).trim();
}

function getOptionalInput(name: string): string | undefined {
  const value = getInput(name, { required: false }).trim();
  return value === "" ? undefined : value;
}

function parsePositiveInteger(
  name: string,
  value: string | undefined,
  defaultValue: number,
): number {
  if (!value) {
    return defaultValue;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`'${name}' must be a positive integer`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`'${name}' must be a positive integer`);
  }

  return parsed;
}

function parseRoleSessionExpiration(value: string | undefined): number {
  const parsed = parsePositiveInteger(
    "role-session-expiration",
    value,
    DEFAULT_ROLE_SESSION_EXPIRATION,
  );

  if (parsed < MIN_ROLE_SESSION_EXPIRATION) {
    throw new Error(
      `'role-session-expiration' must be >= ${MIN_ROLE_SESSION_EXPIRATION}`,
    );
  }

  if (parsed > MAX_ROLE_SESSION_EXPIRATION) {
    throw new Error(
      `'role-session-expiration' must not exceed ${MAX_ROLE_SESSION_EXPIRATION} seconds`,
    );
  }

  return parsed;
}

// Alibaba Cloud STS RoleSessionName: 2-64 characters, only letters, digits, -, _, ., @, =
const ROLE_SESSION_NAME_PATTERN = /^[\w.\-@=]{2,64}$/;

function parseRoleSessionName(value: string | undefined): string {
  const roleSessionName = value ?? DEFAULT_ROLE_SESSION_NAME;
  if (!ROLE_SESSION_NAME_PATTERN.test(roleSessionName)) {
    throw new Error(
      "'role-session-name' must be 2-64 characters and contain only letters, digits, hyphens, underscores, dots, at signs, or equals signs",
    );
  }
  return roleSessionName;
}

function parseRefreshIntervalMs(
  value: string | undefined,
  roleSessionExpiration: number,
): number {
  const refreshIntervalSeconds = parsePositiveInteger(
    "refresh-sts-token-interval-seconds",
    value,
    DEFAULT_STS_REFRESH_INTERVAL_SECONDS,
  );

  if (refreshIntervalSeconds >= roleSessionExpiration) {
    throw new Error(
      "'refresh-sts-token-interval-seconds' must be lower than 'role-session-expiration'",
    );
  }

  return refreshIntervalSeconds * 1000;
}

function resolveAudienceFromGitHubEnvironment(): string {
  const githubServerUrl = process.env.GITHUB_SERVER_URL?.trim();
  const githubRepositoryOwner = process.env.GITHUB_REPOSITORY_OWNER?.trim();

  if (!githubServerUrl || !githubRepositoryOwner) {
    throw new Error(
      "Missing GitHub environment variables. 'GITHUB_SERVER_URL' and 'GITHUB_REPOSITORY_OWNER' are required to build the OIDC audience.",
    );
  }

  let normalizedServerUrl = githubServerUrl.replace(/\/+$/, "");
  try {
    normalizedServerUrl = new URL(normalizedServerUrl).toString().replace(
      /\/+$/,
      "",
    );
  } catch {
    throw new Error(
      `'GITHUB_SERVER_URL' must be a valid URL, got: ${githubServerUrl}`,
    );
  }

  const normalizedRepositoryOwner = githubRepositoryOwner.replace(
    /^\/+/,
    "",
  );
  if (!normalizedRepositoryOwner) {
    throw new Error(
      "'GITHUB_REPOSITORY_OWNER' must not be empty when building the OIDC audience",
    );
  }

  return `${normalizedServerUrl}/${normalizedRepositoryOwner}`;
}

export function parseOidcInputs(): OidcInputs {
  const roleOidcArn = getRequiredInput("role-oidc-arn");
  const oidcProviderArn = getRequiredInput("oidc-provider-arn");
  const audience = resolveAudienceFromGitHubEnvironment();
  const roleSessionExpiration = parseRoleSessionExpiration(
    getOptionalInput("role-session-expiration"),
  );
  const roleSessionName = parseRoleSessionName(
    getOptionalInput("role-session-name"),
  );
  const refreshStsTokenIntervalMs = parseRefreshIntervalMs(
    getOptionalInput("refresh-sts-token-interval-seconds"),
    roleSessionExpiration,
  );

  return {
    audience,
    oidcProviderArn,
    refreshStsTokenIntervalMs,
    roleOidcArn,
    roleSessionExpiration,
    roleSessionName,
  };
}

function normalizeCredential(
  credential: Partial<OidcCredential>,
): OidcCredential {
  if (
    !credential.accessKeyId || !credential.accessKeySecret ||
    !credential.securityToken
  ) {
    throw new Error(
      "Failed to resolve a complete credential set from Alibaba Cloud",
    );
  }

  return {
    accessKeyId: credential.accessKeyId,
    accessKeySecret: credential.accessKeySecret,
    securityToken: credential.securityToken,
  };
}

export async function resolveOidcCredential(
  inputs: OidcInputs,
  options?: ResolveOidcCredentialOptions,
): Promise<OidcCredential> {
  const idToken = await getIDToken(inputs.audience);
  if (options?.debugGitHubIdTokenClaims && isDebug()) {
    await group("Decode GitHub OIDC token claims (debug)", () => {
      debugGitHubIdTokenClaims(idToken);
      return Promise.resolve();
    });
  }
  const temporaryTokenDirectory = await mkdtemp(
    join(os.tmpdir(), "deploy-oss-oidc-"),
  );
  const oidcTokenFilePath = join(temporaryTokenDirectory, "token.jwt");

  try {
    await writeFile(oidcTokenFilePath, idToken, { mode: 0o600 });
    const credentialClient = new CredentialClientCtor(
      new Config({
        type: "oidc_role_arn",
        roleArn: inputs.roleOidcArn,
        oidcProviderArn: inputs.oidcProviderArn,
        oidcTokenFilePath,
        roleSessionExpiration: inputs.roleSessionExpiration,
        roleSessionName: inputs.roleSessionName,
      }),
    );

    return normalizeCredential(
      (await credentialClient.getCredential()) as Partial<OidcCredential>,
    );
  } finally {
    await rm(temporaryTokenDirectory, { force: true, recursive: true });
  }
}
