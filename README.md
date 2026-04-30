# Aliyun OSS CDN Sync Action (GitHub Action)

The Aliyun OSS CDN Sync Action optionally restores and saves a local `_cache`
directory through the GitHub Actions cache service, runs an optional local build
command, uploads a local directory to Aliyun OSS, optionally runs CDN refresh
and preload operations for uploaded paths, and performs post-step cleanup to
remove orphan objects from OSS.

It was originally built to support a personal static-site deployment workflow,
but it is published for reuse and can be adapted to other OSS-backed sites.

## Execution Model

The action runs in three phases:

1. `pre` (`dist/pre/index.js`): assumes an Aliyun RAM role through GitHub OIDC
   and stores temporary credentials in action state.
2. `main` (`dist/main/index.js`): runs the configured `build-command`, uploads
   files to OSS, and runs optional CDN actions. If `cache-enabled` is `true` and
   `cache-key` is configured, it restores the local `_cache` directory before
   the build starts.
3. `post` (`dist/post/index.js`): compares local files to remote OSS objects,
   deletes remote orphans, writes informational cleanup and CDN task summaries,
   refreshes CDN for deleted object URLs when possible, and saves the local
   `_cache` directory when appropriate. `post-if: always()` ensures the post
   step always runs.

## Key Behavior

- `build-command` runs before any OSS upload or CDN call. The default is
  `deno task build`.
- If `build-command` invokes Deno, Deno must already be available in `PATH` on
  the runner. The action checks this explicitly before it starts the build.
- If `cache-enabled` is `true`, cache restore happens at the beginning of the
  `main` step, after repository checkout and before `build-command`.
- Local `_cache` restore/save is opt-in through `cache-key` and
  `cache-restore-keys`. Cache restore/save is best-effort and logged as
  informational or warning output instead of failing the deployment.
- `cache-enabled` controls only the restore path. This lets you disable restore
  temporarily while still allowing the post step to save a new cache snapshot
  for a later run.
- Uploads use `max-concurrency` workers and respect `api-rps-limit`.
- Each file upload is retried up to 3 times before being logged as failed.
- Partial upload failures are surfaced through `failed-count` and the job
  summary. Successfully uploaded files still continue through optional CDN
  processing.
- Uploaded objects are written with ACL `public-read`.
- Cache-Control headers are inferred automatically:
  - `*.html` and `sw.js` -> `no-cache, max-age=0, must-revalidate`
  - hashed assets -> `public, max-age=31536000, immutable`
  - common CSS/JS/JSON/search assets -> `public, max-age=3600, must-revalidate`
  - common image/font assets -> `public, max-age=604800, must-revalidate`
  - `atom.xml`, `feed.json`, and `feed.xml` use their feed-specific content
    types even when they are nested below the input root
- CDN calls are non-fatal: failures are logged as warnings.
- Main-step CDN refresh/preload runs only for object URLs created by the current
  upload pass. If no files are uploaded, the action skips CDN submission for
  that step.
- Cleanup is non-fatal: failures are logged as warnings.
- `cdn-base-url` is required only when `cdn-enabled: true`.
- `audience` is optional. If set, the action calls `core.getIDToken(audience)`.
  If omitted, it calls `core.getIDToken()`.
- Authentication is OIDC-only. The action does not fall back to static access
  keys from inputs or environment variables.
- The action writes a GitHub Actions job summary for deployment, cleanup, and
  informational CDN task status.

## Why Deno for Development

This project uses Deno for development and build tooling. The published action
itself runs on Node.js (`node24`) and does not require Deno on the runner unless
your own `build-command` uses Deno.

## Inputs

| Name                                 | Required | Default                 | Description                                                                                                                                                                 |
| ------------------------------------ | -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role-oidc-arn`                      | Yes      | -                       | RAM role ARN for OIDC role assumption (for example `acs:ram::1234567890123456:role/gh-oss-deploy`)                                                                          |
| `oidc-provider-arn`                  | Yes      | -                       | OIDC provider ARN (for example `acs:ram::1234567890123456:oidc-provider/github`)                                                                                            |
| `audience`                           | No       | `""`                    | Optional OIDC token audience passed to `core.getIDToken(audience)`. If omitted, the action calls `core.getIDToken()`.                                                       |
| `role-session-expiration`            | No       | `900`                   | STS session duration in seconds (`900` to `43200`)                                                                                                                          |
| `role-session-name`                  | No       | `github-action-session` | STS role session name (`2-64` chars, letters/digits/`-`/`_`/`.`/`@`/`=`)                                                                                                    |
| `refresh-sts-token-interval-seconds` | No       | `300`                   | Interval in seconds at which the OSS client refreshes the STS token. Must be strictly less than `role-session-expiration` to ensure the token is renewed before it expires. |
| `input-dir`                          | No       | `_site`                 | Local directory to upload                                                                                                                                                   |
| `bucket`                             | Yes      | -                       | OSS bucket name                                                                                                                                                             |
| `region`                             | Yes      | -                       | OSS region (for example `oss-cn-hangzhou`)                                                                                                                                  |
| `destination-prefix`                 | No       | `""`                    | Prefix inside the bucket                                                                                                                                                    |
| `overwrite`                          | No       | `true`                  | Overwrite objects that already exist                                                                                                                                        |
| `max-concurrency`                    | No       | `5`                     | Parallel uploads                                                                                                                                                            |
| `api-rps-limit`                      | No       | `9000`                  | Global per-run API throttle (`<= 10000`)                                                                                                                                    |
| `endpoint`                           | No       | `""`                    | Custom OSS endpoint                                                                                                                                                         |
| `sdk-timeout-ms`                     | No       | `60000`                 | Timeout in milliseconds applied to individual OSS and CDN SDK calls                                                                                                         |
| `build-command`                      | No       | `deno task build`       | Local build command executed before any OSS upload or CDN action                                                                                                            |
| `cache-enabled`                      | No       | `true`                  | Enable or disable restore of the local `_cache` directory before the build command runs. Post-step save still depends on `cache-key`.                                       |
| `cache-key`                          | No       | `""`                    | Primary cache key for the local `_cache` directory. GitHub Actions expressions such as `hashFiles(...)` are supported.                                                      |
| `cache-restore-keys`                 | No       | `""`                    | Newline-separated restore key prefixes for the local `_cache` directory                                                                                                     |
| `cdn-enabled`                        | No       | `false`                 | Enable CDN actions                                                                                                                                                          |
| `cdn-actions`                        | No       | `""`                    | Supported values: `refresh` or `refresh,preload`. If `cdn-enabled: true` and this input is empty or invalid, the action logs `core.info` and defaults to `refresh`.         |
| `cdn-base-url`                       | Cond.    | `""`                    | Base URL used to build CDN object URLs; required when `cdn-enabled: true`                                                                                                   |
| `cdn-endpoint`                       | No       | `""`                    | Custom CDN API endpoint                                                                                                                                                     |

## Outputs

| Name                   | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `uploaded-count`       | Number of successfully uploaded files                        |
| `skipped-count`        | Number of skipped files (`overwrite: false` + object exists) |
| `failed-count`         | Number of files that still failed after retries              |
| `total-files`          | Number of discovered local files in `input-dir`              |
| `bucket`               | Target bucket                                                |
| `destination-prefix`   | Target prefix                                                |
| `cdn-refresh-task-ids` | Comma-separated CDN refresh task IDs                         |
| `cdn-preload-task-ids` | Comma-separated CDN preload task IDs                         |

## Credential Resolution

`main` and `post` resolve credentials only from OIDC state written by the `pre`
step. There is no credential fallback through action inputs or environment
variables.

If OIDC role assumption fails in `pre`, or if state is unavailable, the action
fails.

## Required Aliyun RAM Permissions

For OIDC to work end to end, configure RAM in three parts:

- Trust policy: the RAM role trust policy must trust your Aliyun OIDC identity
  provider for GitHub.
- OSS permissions: attach OSS permissions for the target bucket and objects used
  by this action, including listing, uploading, and deleting objects under the
  deployed prefix.
- CDN permissions: Aliyun CDN APIs are global-service APIs. Grant the required
  CDN refresh/preload permissions. In many setups, this is the
  `AliyunCDNFullAccess` system policy.

## OIDC Audience and Trust Policy

When you set the `audience` input, the token `aud` claim must match a Client ID
configured on your IdP in Aliyun Resource Access Management (RAM), and that same
value must be allowed in the RAM role trust policy under `oidc:aud`.

Example trust policy condition:

```json
"Condition": {
  "StringEquals": {
    "oidc:aud": [
      "https://github.com/frenchvandal"
    ],
    "oidc:iss": [
      "https://token.actions.githubusercontent.com"
    ]
  }
}
```

## Usage

```yaml
name: Deploy OSS

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read
  actions: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: denoland/setup-deno@v2
        with:
          deno-version-file: .tool-versions
          cache: true

      - name: Run Aliyun OSS CDN Sync Action
        uses: frenchvandal/aliyun-oss-cdn-sync-action@master
        with:
          role-oidc-arn: acs:ram::{Account ID}:role/{Role Name}
          oidc-provider-arn: acs:ram::{Account ID}:oidc-provider/{IdP Name}
          build-command: deno task build
          input-dir: _site
          bucket: my-bucket-name
          region: oss-cn-hangzhou
          overwrite: true
          cache-key: site-cache-${{ runner.os }}-${{ hashFiles('deno.lock', '_config.ts', 'src/**') || github.sha }}
          cache-restore-keys: |
            site-cache-${{ runner.os }}-
          cdn-enabled: true
          cdn-base-url: https://cdn.example.com
          cdn-actions: refresh,preload
```

### Warm a Lume `_cache` Directory

If your build populates a local `_cache` directory, pass both a primary key and
restore prefixes. The primary key can include `hashFiles('_cache/**/*')` so the
post step saves a content-addressed cache, while the restore keys remain broad
enough to warm a fresh runner before the build creates `_cache`.

If you need to bypass restore temporarily without changing the key strategy, set
`cache-enabled: false`. The action will skip the pre-step restore but can still
save the populated `_cache` in the post step.

```yaml
name: Deploy OSS

on:
  push:
    branches: [master]

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: macos-26
    steps:
      - uses: actions/checkout@v6

      - uses: denoland/setup-deno@v2
        with:
          deno-version-file: .tool-versions
          cache: true

      - name: Run Aliyun OSS CDN Sync Action
        uses: frenchvandal/aliyun-oss-cdn-sync-action@master
        with:
          role-oidc-arn: ${{ secrets.ALIYUN_ROLE_ARN }}
          oidc-provider-arn: ${{ secrets.ALIYUN_OIDC_PROVIDER_ARN }}
          build-command: deno task build
          cache-enabled: true
          cache-key: >-
            lume-cache-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('deno.lock') }}-${{ hashFiles('_cache/**/*') || 'empty' }}
          cache-restore-keys: |
            lume-cache-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('deno.lock') }}-
            lume-cache-${{ runner.os }}-${{ runner.arch }}-
          input-dir: _site
          bucket: ${{ secrets.OSS_BUCKET }}
          region: ${{ secrets.OSS_REGION }}
          cdn-enabled: true
          cdn-base-url: ${{ secrets.OSS_CDN_BASE_URL }}
          cdn-actions: refresh
```

## Recommended Configuration for `Frenchvandal/normco.re`

If you want to use this action in the `Frenchvandal/normco.re` repository,
configure the following pieces on the consumer repository side.

### 1. Workflow permissions

The workflow must grant:

```yaml
permissions:
  contents: read
  id-token: write
  actions: write
```

- `id-token: write` is required for GitHub OIDC.
- `actions: write` is recommended when you use `cache-key`, because the action
  restores and saves `_cache` through the GitHub Actions cache service.
- `contents: read` is needed for checkout.

### 2. Repository or environment secrets/variables

At minimum, configure these values in `Frenchvandal/normco.re`:

- `ALIYUN_ROLE_ARN`: the RAM role ARN trusted for GitHub OIDC.
- `ALIYUN_OIDC_PROVIDER_ARN`: the GitHub OIDC provider ARN in Aliyun RAM.
- `OSS_BUCKET`: the target OSS bucket name.
- `OSS_REGION`: the OSS region, such as `oss-cn-hangzhou`.
- `OSS_CDN_BASE_URL`: the public site base URL used for CDN refresh/preload,
  such as `https://normco.re` or your CDN domain.

Optional, if needed:

- `OSS_DESTINATION_PREFIX`: deploy under a subdirectory instead of bucket root.
- `ALIYUN_OIDC_AUDIENCE`: only if your Aliyun OIDC provider and trust policy
  require a custom audience.
- `OSS_ENDPOINT`: only if you need a custom OSS endpoint.
- `CDN_ENDPOINT`: only if you need a custom CDN endpoint.

### 3. Aliyun RAM setup

On the Aliyun side, make sure the GitHub OIDC provider and RAM role are already
configured for the `Frenchvandal/normco.re` repository or for the broader
`Frenchvandal` owner scope you intend to trust.

You need:

- a GitHub OIDC provider in Aliyun RAM;
- a RAM role whose trust policy accepts GitHub-issued tokens;
- OSS permissions for list, upload, and delete on the target bucket/prefix;
- CDN permissions for refresh/preload if `cdn-enabled` is `true`.

### 4. Build command

Set `build-command` to the actual site build command used by
`Frenchvandal/normco.re`.

Examples:

- If the repository builds with Deno/Lume: `deno task build`
- If it builds with npm: `npm ci && npm run build`
- If the site is already generated before this step: set a lightweight command
  that prepares the output directory

The action runs this command itself, so you should avoid rebuilding the site in
an earlier step unless you intentionally want both steps.

### 5. Input directory

Set `input-dir` to the directory produced by your build:

- `_site` for common Lume setups
- `dist` for many frontend frameworks
- another path if `Frenchvandal/normco.re` emits a different publish directory

### 6. Cache configuration

If `Frenchvandal/normco.re` uses a local `_cache` directory during builds,
configure cache inputs so the action can restore it in `pre` and save it in
`post`.

Example:

```yaml
cache-enabled: true
cache-key: lume-cache-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('deno.lock') }}-${{ hashFiles('_cache/**/*') || 'empty' }}
cache-restore-keys: |
  lume-cache-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('deno.lock') }}-
  lume-cache-${{ runner.os }}-${{ runner.arch }}-
```

If the repository does not use `_cache`, leave both inputs empty.

### 7. Example workflow for `Frenchvandal/normco.re`

```yaml
name: Deploy normco.re

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write
  actions: write

concurrency:
  group: normcore-oss-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Deno environment
        uses: denoland/setup-deno@v2
        with:
          deno-version-file: .tool-versions
          cache: true

      - name: Run Aliyun OSS CDN Sync Action
        uses: frenchvandal/aliyun-oss-cdn-sync-action@master
        with:
          role-oidc-arn: ${{ secrets.ALIYUN_ROLE_ARN }}
          oidc-provider-arn: ${{ secrets.ALIYUN_OIDC_PROVIDER_ARN }}
          role-session-name: ${{ github.run_id }}
          role-session-expiration: 3600
          audience: ${{ secrets.ALIYUN_OIDC_AUDIENCE }}
          build-command: deno task build
          cache-enabled: true
          cache-key: >-
            lume-cache-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('deno.lock') }}-${{ hashFiles('_cache/**/*') || 'empty' }}
          cache-restore-keys: |
            lume-cache-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('deno.lock') }}-
            lume-cache-${{ runner.os }}-${{ runner.arch }}-
          input-dir: _site
          bucket: ${{ secrets.OSS_BUCKET }}
          region: ${{ secrets.OSS_REGION }}
          destination-prefix: ${{ vars.OSS_DESTINATION_PREFIX }}
          cdn-enabled: true
          cdn-base-url: ${{ secrets.OSS_CDN_BASE_URL }}
          cdn-actions: refresh,preload
```

If `ALIYUN_OIDC_AUDIENCE` or `OSS_DESTINATION_PREFIX` is not needed in
`Frenchvandal/normco.re`, omit those inputs instead of passing empty secrets.

## CDN Details

- The action checks quota with `DescribeRefreshQuota` before submitting CDN
  requests.
- Refresh requests are submitted before preload requests.
- `cdn-actions` supports only `refresh` and `refresh,preload`. A preload-only
  configuration is treated as invalid.
- If `cdn-enabled: true` and `cdn-actions` is empty or invalid, the action logs
  an informational message and runs `refresh` by default.
- Each CDN API call can include up to 100 URLs.
- Directory preload is translated to file URL preload because Aliyun CDN preload
  is URL-based.
- When directory refresh is enabled, nested directories are collapsed and file
  refresh requests already covered by directory refresh are skipped.

## Post-Step Cleanup Details

- The post step lists OSS objects under `destination-prefix`.
- It computes local object keys from `input-dir` after the build command has
  completed.
- Any remote object missing locally is deleted from OSS.
- If CDN is enabled and `cdn-base-url` is set, deleted file URLs are also sent
  to CDN refresh, subject to remaining quota.
- The post step also reports the status of CDN task IDs created during the main
  step when those task IDs are available.

## Development

Runtime: Deno (version pinned in `.tool-versions`).

Before finalizing changes, run:

```bash
DENO_TLS_CA_STORE=system deno task build
```

Useful additional check:

```bash
DENO_TLS_CA_STORE=system deno task check-dist
```

`dist/` artifacts are versioned and must stay aligned with `src/`.
