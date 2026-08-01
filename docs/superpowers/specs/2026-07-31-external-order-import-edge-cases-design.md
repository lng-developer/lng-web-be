# External Order Import Edge Cases Design

## Goal

Harden `integration/externalOrderImport` against duplicate work, stale processing, queue failure, and partial import failure without changing its public API or module boundaries.

## Scope

This pass covers the existing manual Amazon/Etsy import pipeline from normalized rows through order import, post-import queueing, worker processing, retry, and stale-job recovery.

It does not redesign parsers, add dependencies, add a new retry framework, or change `sqlAttendance`.

## Approach

Use a risk-first audit of existing branches and invariants. Add a test only where current behavior is missing, unsafe, or ambiguous. For each defect, first demonstrate the failure with the narrowest real service test, then make the smallest root-cause change in the shared service or repository used by all callers.

## Required Invariants

1. Retrying an import does not replay records already imported successfully.
2. Completed post-import records are never queued again.
3. `QUEUED` and `PROCESSING` records are recoverable only after their lease or timestamp is stale.
4. A queue add failure leaves every affected raw record in `FAILED`, not `QUEUED`.
5. Failure of one retry candidate does not silently count as a successful enqueue.
6. A non-final worker attempt remains retryable; terminal failure state and issue creation occur only on the final attempt.
7. Missing identifiers cannot create an ambiguous queue job or mutate unrelated raw records.
8. One malformed or failed input group does not prevent independent valid groups from being processed, and the job ends with counters and status matching persisted outcomes.

## Components

- `manualExcelImport.service`: row grouping, partial failure isolation, retry eligibility, and job counters.
- `externalOrderImport.service`: authorized retry and stale active-job recovery.
- `postImportMappingQueue.service`: deterministic job identity and failure-state rollback.
- `postImportMappingProcessor.service` and worker: lease ownership and final-attempt behavior.
- Existing repositories: atomic status/lease operations. Repository changes are allowed only if a failing service test proves the existing operation cannot enforce an invariant.

## Error Handling

Expected row-level failures remain persisted as import issues and contribute to `PARTIAL_FAILED`. Infrastructure failures must be observable on affected raw records. Recovery must remain idempotent: rerunning it may retry eligible work, but must not reopen completed work or duplicate an order item.

## Testing Strategy

1. Run the current `externalOrderImport` suite as the baseline.
2. Audit each invariant against the current tests and implementation.
3. For every confirmed gap, add one focused failing test and verify its expected failure.
4. Apply the minimum production change and rerun the focused test.
5. Run all `externalOrderImport` tests, all Integration tests, the architecture contract, and the full backend suite.

Tests should assert persisted state and returned behavior. Mocks are limited to module public ports and infrastructure boundaries already mocked by the existing suite.

## Success Criteria

- Every confirmed risk has red-green evidence.
- No public route, DTO, status vocabulary, or module dependency changes.
- Existing and new `externalOrderImport` tests pass.
- Integration, architecture, and full backend regressions pass.
- The final diff contains only necessary tests, root-cause fixes, and this design/plan documentation.
