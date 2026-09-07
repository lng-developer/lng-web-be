# Backend CI Sharding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce protected backend CI time by running independent Jest gates in parallel without reducing coverage.

**Architecture:** Two Ubuntu jobs deterministically split all non-PowerShell test files after Jest discovers them. One Windows job runs the PowerShell-only HR test. The existing self-hosted deploy job depends on all three jobs.

**Tech Stack:** GitHub Actions, Node.js 24, npm, Jest, PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-07-backend-ci-sharding-design.md`

## Global Constraints

- Node.js version is 24 in every GitHub-hosted test job.
- Each test gate uses `npm ci` and the npm cache.
- The VPS deploy job must require every test gate and must not run Jest.
- No test is removed from the protected `develop` pipeline.

---

### Task 1: Split the backend test gate

**Files:**
- Modify: `.github/workflows/develop.yml`
- Test: GitHub Actions run for `develop`

**Interfaces:**
- Consumes: `npx jest --listTests` and the Windows-only path `tests/hr/scripts/hrCutoverTools.test.js`.
- Produces: required jobs `core-test-1`, `core-test-2`, and `windows-powershell-test`.

- [ ] **Step 1: Define the Windows-only test command**

```yaml
windows-powershell-test:
  runs-on: windows-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 24
        cache: npm
    - run: npm ci
    - run: npm test -- tests/hr/scripts/hrCutoverTools.test.js --runInBand --silent
```

- [ ] **Step 2: Define a two-entry Ubuntu core-test matrix**

```yaml
core-test:
  name: Core test ${{ matrix.shard }}/2
  runs-on: ubuntu-latest
  strategy:
    fail-fast: false
    matrix:
      shard: [0, 1]
```

- [ ] **Step 3: Run only each deterministic core shard**

```bash
mapfile -t all_tests < <(npx jest --listTests)
core_tests=()
for path in "${all_tests[@]}"; do
  [[ "$path" == *"hrCutoverTools.test.js" ]] && continue
  core_tests+=("$path")
done
selected=()
for index in "${!core_tests[@]}"; do
  (( index % 2 == ${{ matrix.shard }} )) && selected+=("${core_tests[$index]}")
done
npx jest --runInBand --silent "${selected[@]}"
```

- [ ] **Step 4: Require all test jobs before deployment**

```yaml
deploy:
  needs: [core-test, windows-powershell-test]
```

- [ ] **Step 5: Validate workflow YAML and local command discovery**

Run: `npx jest --listTests`

Expected: the Windows-only test path is returned exactly once and the remaining files can be partitioned by index.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/develop.yml docs/superpowers/specs/2026-09-07-backend-ci-sharding-design.md docs/superpowers/plans/2026-09-07-backend-ci-sharding.md
git commit -m "ci(deploy): shard backend test gates"
```

### Task 2: Verify protected deployment behavior

**Files:**
- Test: GitHub Actions run for `develop`

**Interfaces:**
- Consumes: the three completed test gates from Task 1.
- Produces: a verified deploy result tied to the pushed workflow SHA.

- [ ] **Step 1: Push the workflow commit**

Run: `git push origin develop`

Expected: GitHub creates one `Deploy Backend` run for the commit SHA.

- [ ] **Step 2: Verify every test gate completes successfully**

Run: `gh run view <run-id> --json conclusion,jobs,headSha,url`

Expected: both Ubuntu shards and the Windows PowerShell job are successful.

- [ ] **Step 3: Verify deploy completion**

Run: `gh run view <run-id> --log-failed`

Expected: no failed logs and the deploy job is successful after all gates.
