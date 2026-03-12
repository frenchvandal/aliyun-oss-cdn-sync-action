# Changelog

## [1.0.3](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/compare/v1.0.2...v1.0.3) (2026-03-12)


### Bug Fixes

* **cdn:** default invalid cdn actions to refresh when enabled ([a4a4763](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/a4a476345d158c93a3b026ee44059efa12b86deb))

## [1.0.2](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/compare/v1.0.1...v1.0.2) (2026-03-12)


### Features

* **oidc:** add optional audience input for GitHub ID token ([cbf76a5](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/cbf76a55da324f6e2393076e14e73ae895dde303))
* **pre:** decode github oidc token claims in debug mode ([fea0eb9](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/fea0eb9066dfc85a341394b0d6ed9f4de93812f7))
* **upload:** add OSS progress bar and move file logs to debug ([eb5ca89](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/eb5ca89d440f0d6901a928fe5f4d2710764d969a))


### Bug Fixes

* **cache:** apply oss cache headers and remove quota samples ([78ad5e9](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/78ad5e9169498cd6d986e54f8817e8353a783492))
* **ci:** use github token for release and tag workflows ([fbb6bbb](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/fbb6bbbc27651896334426ac533bbf74609be89a))
* **post:** log cdn task lookup summary in cleanup group ([3ce9ddf](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/3ce9ddf5fe15c9b5136a528eeb9f11b5e313ac0e))
* **pre:** clarify oidc debug logging and deno workspace detection ([bf95d99](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/bf95d9959dfd137555a78aa72d9deda2d94ef7e9))
* **pre:** gate oidc claim logs with actions core debug mode ([4e71035](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/4e71035d540222f9213f38f785d619d355f40a1d))
* **pre:** log decoded oidc token claims with info for troubleshooting ([8eea6aa](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/8eea6aad37e64e0c8853a632fdeb32bf8e308365))
* **pre:** use actions core debug group for oidc token claims ([0c7ead5](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/0c7ead5f8eb0a4d24d96a453554d0a8b0efa142f))

## [1.0.1](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/compare/1.0.0...v1.0.1) (2026-03-10)


### Bug Fixes

* **cdn:** reduce quota-exhaustion noise and unnecessary URL work ([2e08070](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/2e080703d88c79ec1b06d46008934b9c528520e9))
