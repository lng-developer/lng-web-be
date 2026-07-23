# CI and Test Baseline Design

## Status

Approved design for planning. This workstream is first in the roadmap and changes no production behavior.

## Problem

The architecture suite passes, but the focused E2E suite is not a trustworthy baseline:

- Jest discovers tests inside `.worktrees`, so a local worktree can duplicate or contaminate a run.
- `src/test/e2e/orderFulfillmentFlow.e2e.test.js` mocks the production repository contract incompletely and fails when `productionTask.service.js` calls `updateScaledOutputIfMutable`.
- There is no single documented verification order for architecture, E2E, and the full suite.

Feature work built on a red or machine-dependent baseline cannot distinguish a regression from test harness drift.

## Goal

Make test discovery deterministic and establish one green, repeatable verification baseline without changing application behavior.

## Non-Goals

- Rewriting Jest configuration or introducing another test runner.
- Increasing unit coverage unrelated to the failing baseline.
- Refactoring production services to accommodate mocks.
- Creating a CI provider workflow before the local commands are reliable.

## Scope

### Deterministic discovery

Jest must ignore every repository-local `.worktrees` directory. The rule belongs in Jest configuration, not in developer-specific commands.

### Contract-faithful E2E mock

The production repository mock in `orderFulfillmentFlow.e2e.test.js` must expose `updateScaledOutputIfMutable(taskId, patch)`. Its behavior must match the repository contract relevant to the E2E flow:

- return the updated task while scaled output is mutable;
- return `null` when the task has passed the mutability boundary;
- preserve unrelated task fields.

The mock must not replace or weaken the production guard.

### Verification ladder

The canonical order is:

1. `npm run test:architecture -- --runInBand`
2. `npm test -- src/test/e2e --runInBand`
3. `npm test -- --runInBand`

The first failing command stops the workstream. Commands must run from the repository root.

## Expected Files

- Modify `package.json` only if Jest configuration already lives there; otherwise modify the existing Jest configuration file.
- Modify `src/test/e2e/orderFulfillmentFlow.e2e.test.js`.
- Update an existing contributor/testing document only if a canonical verification section already exists.

No production file is expected to change.

## Acceptance Criteria

- A test run from the repository root does not discover files below `.worktrees`.
- The order fulfillment E2E flow passes with a contract-faithful production repository mock.
- Architecture, E2E, and full-suite commands all exit with code `0`.
- `git diff` contains test/configuration/documentation changes only.
- No dependency is added.

## Risks and Controls

- **Risk:** An ignore pattern hides legitimate source tests.
  **Control:** Match directory segments named `.worktrees`, not broad path fragments.
- **Risk:** The mock becomes more permissive than the repository.
  **Control:** Cover both mutable and immutable results in the focused test.
- **Risk:** Full-suite failures reveal unrelated existing defects.
  **Control:** Record the exact failing suite; do not suppress or skip it in this workstream.

## Exit Gate

The POD Golden Flow workstream may start only after the three-command verification ladder passes from the primary checkout.
