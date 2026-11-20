# Main Release Deploy-Only Design

## Intent

Run the full backend quality gate only for changes entering `develop`. A release PR from `develop` to `main` validates that its source branch is exactly `develop`; after merge, `main` runs only the VPS deployment and existing health checks.

## Safety constraints

- `main` must only accept pull requests whose head ref is `develop`.
- Direct pushes to `main` must be prevented by a GitHub branch rule, not merely by YAML conditions.
- The deployment keeps its existing rollback and health-check logic.
- Pull requests to `develop` keep all current tests unchanged.

## Non-goals

- No application-code or test-suite changes.
- No changes to deployment credentials, host, or rollback behavior.
