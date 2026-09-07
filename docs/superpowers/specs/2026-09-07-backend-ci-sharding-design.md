# Backend CI Sharding Design

## Goal

Reduce the time to a protected backend deployment without removing test coverage.

## Current evidence

- The full Jest suite has 358 suites and is deliberately invoked with `--runInBand`.
- `tests/hr/scripts/hrCutoverTools.test.js` invokes `powershell.exe`; it cannot run on Linux.
- The self-hosted Linux runner cannot run `mongodb-memory-server` reliably because its CPU lacks AVX.

## Design

The deployment workflow has three required, independent gates:

1. `core-test-1` and `core-test-2` run the non-PowerShell Jest suite on separate `ubuntu-latest` runners.
2. `windows-powershell-test` runs only `tests/hr/scripts/hrCutoverTools.test.js` on `windows-latest`.
3. `deploy` requires every gate, remains self-hosted, and does not run Jest.

Core suite membership is deterministic and disjoint: Jest lists files, filters the Windows-only filename, and allocates the remaining paths alternately by index. Each runner starts a fresh `mongodb-memory-server`, avoiding shared test state.

## Constraints

- Node.js version is 24 in all GitHub-hosted test jobs.
- `npm ci` and the npm cache remain mandatory in each hosted job.
- A failing or cancelled test gate must prevent VPS deployment.
- No test is removed from the protected `develop` pipeline.
