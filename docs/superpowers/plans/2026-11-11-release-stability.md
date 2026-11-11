# Release Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent invalid backend source from reaching the VPS and stop PM2 from restart-looping when startup fails.

**Architecture:** Add a dependency-free application-load smoke script and run it in CI and on the VPS before PM2 is touched. Manage the process through a committed PM2 ecosystem configuration with bounded exponential restart behavior; the deploy job verifies a stable health window after restart.

**Tech Stack:** GitHub Actions, Node.js, PM2, Bash.

**Spec:** User-requested production stability hardening after the 2026-11-11 shipment validator startup crash.

## Global Constraints

- Do not modify business modules or include existing unrelated working-tree changes.
- Preserve the existing `/srv/lng-web-be/.env` and PM2 process name `lng-web-be`.
- Do not add dependencies.

## Review Focus

- Missing module import: app-load smoke must exit non-zero before deployment.
- Healthy but repeatedly restarting process: post-restart health window must fail deployment.
- Startup failure: PM2 must back off and stop after bounded unstable restarts.
- Existing production environment: smoke script must preserve configured environment values.

### Task 1: Startup smoke check

**Files:**
- Create: `tools/scripts/smoke/loadApp.js`
- Modify: `package.json`
- Modify: `.github/workflows/develop.yml`

- [x] Add a script that supplies only absent test-safe config values, constructs `src/app`, and exits non-zero on module-load failure.
- [x] Expose it as `npm run smoke:startup` and run it in a dedicated CI job before deployment.
- [x] Run the smoke command locally and verify it passes.

### Task 2: Bounded PM2 recovery and deploy verification

**Files:**
- Create: `ecosystem.config.js`
- Modify: `.github/workflows/develop.yml`

- [x] Add the single-process PM2 definition for `/srv/lng-web-be`, with a ten-second minimum uptime, exponential backoff, and five failed-start limit.
- [x] Run the exact production smoke command on the VPS before process reload.
- [x] Replace the direct PM2 reload with `startOrReload`, then assert health remains successful and restart count unchanged for thirty seconds.
- [x] Validate workflow behavior through the GitHub Actions run triggered by this commit, alongside local JavaScript syntax checks.
