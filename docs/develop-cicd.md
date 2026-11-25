# Develop CI/CD

BE and FE have separate develop deployment jobs; production jobs remain main-only.

- Pull requests run on GitHub-hosted runners. Self-hosted runners only deploy successful artifacts from a develop push or an explicitly requested manual dispatch, never a PR event.
- A develop push verifies the exact resulting commit in hosted CI, then deploys without running test suites on the application server. This also covers direct pushes where branch-protection settings cannot be verified.
- For a pre-merge smoke deployment, manually dispatch the workflow on the reviewed branch with `deploy_develop=true`. All CI gates must pass first. This does not enable automatic develop deployments until the workflow PR is merged.
- Manual UI-test-only FE runs cannot deploy. Manual main runs cannot deploy to develop.
- Existing runners must have standard labels `self-hosted`, `Linux`, `X64`; scripts additionally require hostname `lng`.
- Node 24 is installed through setup-node and pinned as the PM2 interpreter per release. Other applications retain their runtimes.
- Releases live in `/home/lng/apps/lng-web-be-develop/releases` and `/home/lng/apps/lng-web-fe-develop/releases`, with a `current` symlink and `DEPLOYED_SHA`. Old runtime directories and server-local changes are preserved.
- BE reuses `/home/lng/apps/lng-web-be/.env.development`, requires database `lng_web_be_develop` and Redis DB 15, and disables automatic background startup through `BACKGROUND_JOBS_ENABLED=false`. Normal environments default to true. The staging process uses APP_ENV=development and NODE_ENV=production to disable Mongoose autoIndex and use production HTTP/security behavior; its database remains the isolated dev database.
- Dedicated `lng-web-be-import-workers` stays stopped. No schema/index/seed/migration command runs as part of deployment.
- Develop requires blocked outbound: Node HTTP/fetch and external TCP, extension claim/start/renew and Wasabi signing are denied. Only configured MongoDB/Redis TCP connections remain available. External schedulers stay off independently of the background switch. See `environment-configuration.md` for scope and limitations. Async worker-driven features intentionally do not progress while background jobs remain disabled.
- FE uses a production-optimized build with empty API/upload base URLs, so browser requests use the develop origin and its reverse proxy.
- Deployments serialize per server. Failed BE activation restores the previous managed release, or stops the API if no safe previous release exists. FE restores the previous managed release, or the original FE server. No automatic DB rollback.
- Production promotion remains a reviewed PR from develop to main, after user UAT; do not merge automatically.

Verification: BE background startup regression, server syntax, startup smoke, architecture contracts; FE lint/build/config tests; hosted full suites before any deploy; runner verifies PM2 cwd, health stability (BE) and served index hash (FE).
