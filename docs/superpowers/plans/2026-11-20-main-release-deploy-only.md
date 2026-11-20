# Main Release Deploy-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avoid duplicate backend tests during a verified `develop` to `main` release while retaining release-source validation and deployment health checks.

**Architecture:** `.github/workflows/develop.yml` keeps its test jobs for `develop` PRs and pushes. A small `release-source` job validates a `main` PR originates from `develop`; the deploy job runs only for a push to `main`. A GitHub branch rule prevents unreviewed/direct pushes to `main`.

**Tech Stack:** GitHub Actions YAML, GitHub branch protection API.

**Spec:** `docs/superpowers/specs/2026-11-20-main-release-deploy-only-design.md`

## Global Constraints

- Do not modify runtime deployment scripts, secrets, or health checks.
- Preserve the full quality gate for `develop`.
- No new dependencies.

## Review Focus

- PR from any branch other than `develop` to `main` must fail the source guard.
- A PR to `develop` still schedules every backend quality job.
- A push to `main` schedules deploy without test jobs.
- Direct push to `main` is blocked by branch protection.

---

### Task 1: Split backend release workflow paths

**Files:**
- Modify: `.github/workflows/develop.yml`

**Interfaces:**
- Consumes: GitHub `pull_request` and `push` event context.
- Produces: required `release-source` check for PRs targeting `main` and `Deploy to VPS` on pushes to `main`.

- [ ] Add a release-source job that fails unless `github.head_ref == 'develop'` on pull requests targeting `main`.
- [ ] Gate the existing test jobs to `develop` only, without changing their commands.
- [ ] Change deploy dependencies to the release-only job and preserve its main-push guard.
- [ ] Validate YAML event/job conditions by inspecting the rendered diff.

### Task 2: Protect backend main releases

**Files:**
- External configuration: GitHub repository branch protection for `main`

**Interfaces:**
- Consumes: `release-source` status check.
- Produces: no direct pushes, PR required, `release-source` required before merge.

- [ ] Apply the branch rule after the workflow PR is merged and its check exists.
- [ ] Verify API readback shows PR requirement, direct-push restriction, and required `release-source` check.
