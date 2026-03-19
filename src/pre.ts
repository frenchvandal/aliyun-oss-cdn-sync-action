import { group, info, saveState, setFailed, setSecret } from "@actions/core";

import {
  STATE_ACCESS_KEY_ID,
  STATE_ACCESS_KEY_SECRET,
  STATE_SECURITY_TOKEN,
} from "./constants.ts";
import { parseOidcInputs, resolveOidcCredential } from "./oidc.ts";
import { emitDebugNotice } from "./shared.ts";

export async function run(): Promise<void> {
  const inputs = parseOidcInputs();
  const credential = await group(
    "Resolving Alibaba Cloud credentials via GitHub OIDC",
    async () => {
      info(
        "Resolving Alibaba Cloud credentials with GitHub OIDC role assumption",
      );
      return await resolveOidcCredential(inputs, {
        debugGitHubIdTokenClaims: true,
      });
    },
  );

  // Mask credential values in all subsequent log output.
  setSecret(credential.accessKeyId);
  setSecret(credential.accessKeySecret);
  setSecret(credential.securityToken);

  // Persist the resolved credential to action state so the main and post
  // steps can read it via getState(), without relying on exported
  // environment variables.
  saveState(STATE_ACCESS_KEY_ID, credential.accessKeyId);
  saveState(STATE_ACCESS_KEY_SECRET, credential.accessKeySecret);
  saveState(STATE_SECURITY_TOKEN, credential.securityToken);

  emitDebugNotice(
    "Aliyun OIDC credential ready",
    `sessionName=${inputs.roleSessionName}, expirationSeconds=${inputs.roleSessionExpiration}, refreshIntervalSeconds=${
      inputs.refreshStsTokenIntervalMs / 1000
    }, audience=${inputs.audience ?? "(default)"}`,
  );
  info("Alibaba Cloud credentials resolved and stored in action state");
}

run().catch((error: unknown) => {
  if (error instanceof Error) {
    setFailed(error.message);
    return;
  }
  setFailed(String(error));
});
