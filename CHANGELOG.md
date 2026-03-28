# Changelog

## [1.0.8](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/compare/v1.0.7...v1.0.8) (2026-03-28)


### Bug Fixes

* **content-type:** force RSS and Atom feed MIME types ([c1fd785](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/c1fd785c5fc1b8fa28ad7c8ec4b5d8de3cc8c7c6))

## [1.0.7](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/compare/v1.0.6...v1.0.7) (2026-03-19)


### Bug Fixes

* **build-command:** probe executable before running build ([3c2c4f0](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/3c2c4f07c69a6332ce90f8de0458c49da754ea5f))

## [1.0.6](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/compare/v1.0.5...v1.0.6) (2026-03-19)


### Features

* add debug runner annotations ([729ec04](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/729ec0418e15eb7e995edbfbc605e7018383b6c1))
* **cache:** add cache restore toggle ([7993608](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/7993608555be06a9c8ce5b71c46121a180bd16e2))


### Bug Fixes

* **cache:** log post-step cache save outcomes ([25ae047](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/25ae0478c38b4e931717736ca39147bd6f303a5e))
* **cache:** restore cache after checkout ([18d10cf](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/18d10cf0f070530f8dd4ea0e1d6e921bcb9c288f))

## [1.0.5](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/compare/v1.0.4...v1.0.5) (2026-03-19)


### Features

* **action:** add build command and local cache support ([6922c96](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/6922c965b68efb07b8270e2ba0ecda440be21655))

## [1.0.4](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/compare/v1.0.3...v1.0.4) (2026-03-18)


### Bug Fixes

* **cache:** refine default oss cache headers ([b16b4d3](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/b16b4d35809241c6f5d51a5826e8569eef92e62c))
* **content-type:** set root feed.json content type ([9a3ebd6](https://github.com/frenchvandal/aliyun-oss-cdn-sync-action/commit/9a3ebd6f63b1a389a0aacf3c25ef2d1a2ec155d5))

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
