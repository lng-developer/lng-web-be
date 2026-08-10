# Repository Folder Policy

This backend keeps runtime code and operational tooling separate.

## Runtime Code

- Keep application entrypoints in `src/app.js` and `src/server.js`.
- Keep module-owned runtime code under `src/modules/<module>/`.
- Keep module workers under `src/modules/<module>/workers/`.
- Keep module scripts under `src/modules/<module>/scripts/` only when they are tightly coupled to that module's internals or public maintenance contract.

## Operational Tooling

- Put cross-module scripts under `tools/scripts/`.
- Use `tools/scripts/seed/` for demo or setup seed orchestration.
- Use `tools/scripts/maintenance/` for repairs, cleanup, backfills, and database maintenance.
- Use `tools/scripts/audit/` for read-only audits and report helpers.
- Use `tools/scripts/diagnostics/` for probes and one-off connectivity checks.
- Use `tools/scripts/benchmarks/` for benchmark helpers.
- Use `tools/api-contract/` for API inventory and Postman contract generation.

## Tests

- Keep existing module tests under `tests/<module>/`.
- Put tests for `tools/` under `tests/tools/`.

## New Files

Do not add ad hoc files at the repository root or under `src/scripts/`. Pick the smallest existing folder that matches the file's responsibility.
