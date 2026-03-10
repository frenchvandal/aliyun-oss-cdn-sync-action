// Action state keys used to pass the OIDC-resolved credential from the pre
// step to the main and post (cleanup) steps, so that they can read credentials
// via getState() instead of relying on exported environment variables.
export const STATE_ACCESS_KEY_ID = "pre-access-key-id";
export const STATE_ACCESS_KEY_SECRET = "pre-access-key-secret";
export const STATE_SECURITY_TOKEN = "pre-security-token";

// Action state keys used to pass CDN task IDs emitted by the main step to the
// post (cleanup) step for informational task status reporting.
export const STATE_CDN_REFRESH_TASK_IDS = "main-cdn-refresh-task-ids";
export const STATE_CDN_PRELOAD_TASK_IDS = "main-cdn-preload-task-ids";
