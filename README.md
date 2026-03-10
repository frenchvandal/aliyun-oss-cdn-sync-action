# Alibaba OSS CDN Sync Action (GitHub Action)

The Alibaba OSS CDN Sync Action uploads a local directory to Aliyun OSS,
optionally runs CDN refresh/preload operations for uploaded paths, and performs
post-action cleanup to remove orphan objects from OSS.

It was originally built to cover a customized personal workflow: upload a
Lume-generated blog build to Aliyun OSS and refresh CDN cache. The action is
published for reuse, and the code can be freely forked.

## Execution Model

The action runs in three phases:

1. `pre` (`dist/pre/index.js`): assumes an Aliyun RAM role through GitHub OIDC
   and stores temporary credentials in action state.
2. `main` (`dist/main/index.js`): uploads files to OSS and runs optional CDN
   actions.
3. `post` (`dist/cleanup/index.js`): compares local files to remote OSS objects
   and deletes remote orphans. `post-if: always()` ensures cleanup always runs.

## Key Behavior

- Uploads use `max-concurrency` workers and respect `api-rps-limit`.
- Each file upload is retried up to 3 times before being logged as failed.
- Uploaded objects are written with ACL `public-read`. For OSS static website
  hosting, this is an Aliyun constraint for publicly readable site assets in the
  bucket.
- CDN calls are non-fatal: failures are logged as warnings.
- Cleanup is non-fatal: failures are logged as warnings.
- `cdn-base-url` is required only when `cdn-enabled: true`.
- OIDC audience is built automatically as
  `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY_OWNER}` from GitHub runner
  environment variables. In Aliyun RAM OIDC, this audience must match the IdP
  Client ID configured on the OIDC provider. For GitHub OIDC, that Client ID is
  the repository owner URL.

## Why Deno for Development

This project uses Deno for development and build tooling by design. In my
opinion, the developer experience is more pleasant for this type of action.

- TypeScript is native, so there is no separate TypeScript runtime or compiler
  setup for day-to-day development tasks.
- Deno provides native `bundle`, `lint`, and `fmt` capabilities, which reduces
  the number of external dependencies and config files to maintain.
- Deno has practical Node interoperability, so this project can still rely on
  Node-compatible packages while shipping bundles that run in GitHub Actions on
  `node24`.

Important: this action itself runs on Node.js (`node24`) and does not require
installing Deno on the runner that uses
`frenchvandal/aliyun-oss-cdn-sync-action`.

## Inputs

| Name                                 | Required | Default                 | Description                                                                                                                                                                 |
| ------------------------------------ | -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role-oidc-arn`                      | Yes      | -                       | RAM role ARN for OIDC role assumption (for example `acs:ram::1234567890123456:role/gh-oss-deploy`)                                                                          |
| `oidc-provider-arn`                  | Yes      | -                       | OIDC provider ARN (for example `acs:ram::1234567890123456:oidc-provider/github`)                                                                                            |
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
| `cdn-enabled`                        | No       | `false`                 | Enable CDN actions                                                                                                                                                          |
| `cdn-actions`                        | No       | `""` (`none`)           | CDN actions (comma-separated: `refresh`, `preload`, `none`). Empty value is treated as `none`.                                                                              |
| `cdn-base-url`                       | Cond.    | `""`                    | Base URL used to build CDN object URLs; required when `cdn-enabled: true`                                                                                                   |
| `cdn-endpoint`                       | No       | `""`                    | Custom CDN API endpoint                                                                                                                                                     |

`GITHUB_SERVER_URL` and `GITHUB_REPOSITORY_OWNER` are default environment
variables provided by GitHub Actions runners, and are used to compute the OIDC
audience automatically.

### Credential Resolution (OIDC Only)

`main` and `post` resolve credentials only from OIDC state written by the `pre`
step. There is no credential fallback through action inputs or environment
variables.

If OIDC role assumption fails in `pre`, or if state is unavailable, the action
fails.

### Required Aliyun RAM Permissions

For OIDC to work end to end, configure RAM in three parts:

- Trust policy: the RAM role trust policy must trust your Aliyun OIDC identity
  provider for GitHub.
- OSS permissions: attach OSS permissions for the target bucket and its objects
  used by this action (`ListObjects`, `PutObject` and `DeleteObject`) on the
  bucket resources you deploy to.
- CDN permissions: Aliyun CDN APIs are global-service APIs. Grant the
  `AliyunCDNFullAccess` system policy.

## Outputs

| Name                   | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| `uploaded-count`       | Number of successfully uploaded files                        |
| `skipped-count`        | Number of skipped files (`overwrite: false` + object exists) |
| `total-files`          | Number of discovered local files in `input-dir`              |
| `bucket`               | Target bucket                                                |
| `destination-prefix`   | Target prefix                                                |
| `cdn-refresh-task-ids` | Comma-separated CDN refresh task IDs                         |
| `cdn-preload-task-ids` | Comma-separated CDN preload task IDs                         |

## Usage

```yaml
name: Deploy OSS

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Run Alibaba OSS CDN Sync Action
        uses: frenchvandal/aliyun-oss-cdn-sync-action@v1
        with:
          role-oidc-arn: acs:ram::{Account ID}:role/{Role Name}
          oidc-provider-arn: acs:ram::{Account ID}:oidc-provider/{IdP Name}
          input-dir: _site
          bucket: my-bucket-name
          region: oss-cn-hangzhou
          overwrite: true
          cdn-enabled: true
          cdn-base-url: https://cdn.example.com
          cdn-actions: refresh,preload
```

### Deploy Static Content to OSS

```yaml
# Deploy static content to Aliyun OSS
name: Deploy static content to OSS

on:
  push:
    branches: ["master"]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

concurrency:
  group: "oss-deploy"
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: development
    runs-on: macos-26

    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Run Aliyun OSS CDN Sync Action
        uses: frenchvandal/aliyun-oss-cdn-sync-action@v1
        with:
          role-oidc-arn: ${{ secrets.ALIBABA_ROLE_ARN }}
          oidc-provider-arn: ${{ secrets.ALIBABA_OIDC_PROVIDER_ARN }}
          role-session-name: ${{ github.run_id }}
          role-session-expiration: 3600
          input-dir: _site
          bucket: ${{ secrets.OSS_BUCKET }}
          region: ${{ secrets.OSS_REGION }}
          cdn-enabled: true
          cdn-base-url: ${{ secrets.OSS_CDN_BASE_URL }}
          cdn-actions: refresh,preload
```

## CDN Details

- The action checks quota with `DescribeRefreshQuota` before submitting CDN
  requests.
- Refresh requests are submitted before preload requests.
- Each CDN API call can include up to 100 URLs.
- Directory preload is translated to file URL preload because Aliyun CDN preload
  is URL-based.
- When directory refresh is enabled, nested directories are collapsed and file
  refresh requests already covered by directory refresh are skipped.

## Post Cleanup Details

- The cleanup phase lists OSS objects under `destination-prefix`.
- It computes local object keys from `input-dir`.
- Any remote object missing locally is deleted from OSS.
- If CDN is enabled and `cdn-base-url` is set, deleted file URLs are also sent
  to CDN refresh (subject to quota).

## Development

Runtime: Deno (version pinned in `.tool-versions`).

Before finalizing changes, run:

```bash
deno task build
```

Useful additional check:

```bash
deno task check-dist
```

`dist/` artifacts are versioned and must stay aligned with `src/`.
