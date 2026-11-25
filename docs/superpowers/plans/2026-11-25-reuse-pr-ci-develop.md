# Reuse PR CI for develop deployment

Goal: PRs run tests/build once; a develop push deploys only an artifact from matching successful PR CI.

Implementation:
- Add a hosted verification job and API-only selector script in both repos. Find the merged PR associated with the exact pushed commit, matching same-repository head and develop base.
- Require a completed successful pull_request run from the expected workflow, all named test jobs successful, and an unexpired artifact named with the exact Git tree of the deployed commit.
- BE packages source after PR tests; FE retains its tested build. Name artifacts by the checked-out Git tree and keep them 14 days.
- Develop push skips tests/build/package and downloads the verified artifact ID from that run. Manual dispatch is verification only. Main release behavior stays unchanged.
- No fallback build/test after merge. Missing, stale, failed, expired or mismatched CI stops deployment. Update/retest the PR against develop before merge.

Verification: mock GitHub API tests for valid merge, direct push, wrong head/repo/workflow, failed/missing jobs, mismatched tree, and expired artifacts. Check YAML conditions and run existing PR CI. Do not merge without user approval.
