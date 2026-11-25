# Develop CI/CD

BE and FE have separate develop deployment jobs; production jobs remain main-only.

- Pull requests run on GitHub-hosted runners. Self-hosted runners only deploy successful artifacts after a develop push, never a PR or manual-dispatch event.
- PR CI runs the suites and records the tested Git tree in the artifact name. A develop push runs only a hosted provenance gate, then deploys that exact artifact; it does not rerun tests or rebuild FE. The merged commit tree must equal the tested tree.
- Manual dispatch runs verification only. Develop deployment requires a push to develop after PR merge.
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

## Reusing PR CI

The gate requires a merged same-repository PR targeting develop, the latest matching
successful pull_request run of this workflow, all expected test jobs successful,
and a non-expired artifact for the merged Git tree. Artifact IDs and run IDs come
from GitHub API metadata. Only the hosted gate has pull-request read access; the
self-hosted deploy job downloads the verified ID with actions:read.

Artifacts are retained for 14 days. Direct pushes, forks, stale base trees, missing
CI and expired artifacts fail closed. Update/retest the PR against current develop
before merging. For an expired artifact after merge, rerun the original PR workflow
if its tested tree is still identical, then rerun the failed develop push workflow.
Manual dispatch is not an accepted deployment evidence source. There is no fallback
that silently reruns tests or builds after merge. A superseded develop push is rejected.

The first merge of this workflow must have green PR CI with the new tree-named artifact.
Main retains its production-mode build because its environment differs from develop.
Download behavior follows [actions/download-artifact](https://github.com/actions/download-artifact).
