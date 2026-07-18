# Task 1 Report: Design Submission Score Model And Repository

## Scope

Implemented only the Task 1 persistence slice:

- Added score level and status constants.
- Added the `DesignSubmissionScore` Mongoose model.
- Added the score repository with auto-upsert, lookup, override, void, and summary operations.
- Added focused repository tests using the configured MongoDB connection.

No service, controller, route, DTO, validator, dependency, or unrelated worktree file was changed.

## TDD Evidence

### RED

The repository test was written first and run with:

```text
npm test -- src/test/design/repositories/designSubmissionScore.repository.test.js --runInBand
```

After correcting the test-only relative imports, the expected failure was:

```text
FAIL src/test/design/repositories/designSubmissionScore.repository.test.js
Cannot find module '../../../modules/design/repositories/designSubmissionScore.repository'
```

This confirmed the test failed because the required production model/repository had not yet been added.

### GREEN

After adding the minimum production implementation, the same command passed:

```text
Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

The tests exercised real MongoDB behavior for:

- one score per `{ taskId, submissionId }`;
- repeated auto-score not overwriting an existing override/final points;
- empty submission ID lookup returning without a query result;
- active-only aggregation excluding voided scores;
- inclusive UTC end-of-day `dateTo` handling;
- voiding only an active score.

Additional verification passed:

```text
npm run test:architecture -- --runInBand
Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
```

All four changed JavaScript files also passed `node -c` syntax checks.

## Changed Files

- `src/modules/design/constants/design.constants.js`
  - Exported `designScoreLevels`: `BASIC`, `STANDARD`, `HARD`, `BONUS`.
  - Exported `designScoreStatuses`: `ACTIVE`, `VOIDED`.
- `src/modules/design/models/designSubmissionScore.model.js`
  - Stores score snapshots, points, rule, override, scorer, and void metadata.
  - Adds the unique task/submission index and required reporting indexes.
- `src/modules/design/repositories/designSubmissionScore.repository.js`
  - Uses `$setOnInsert` for idempotent auto-scoring.
  - Uses lean reads and no-op empty-ID lookup.
  - Restricts voiding to active scores.
  - Defaults summaries to active scores and aggregates totals by designer and task type.
- `src/test/design/repositories/designSubmissionScore.repository.test.js`
  - Focused real-database repository coverage.
- `.superpowers/sdd/task-1-report.md`
  - This implementation and verification report.

## Self-Review

- The model keeps historical designer, team, and department snapshots rather than resolving current organization data during reporting.
- `upsertAutoScore` never applies updates to an existing document, so leader overrides survive repeated approval/retry calls.
- Summary date filtering uses UTC `23:59:59.999` for an inclusive date-only `dateTo`.
- Expected limitation: concurrent first-time inserts can still surface MongoDB duplicate-key behavior under a race; the unique index preserves correctness, and retry handling belongs to the higher-level scoring workflow rather than this repository-only task.
- No production behavior outside Task 1 was expanded.
