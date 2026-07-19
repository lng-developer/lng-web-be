# Task 2 report

## Delivered minimal slice

Leave and overtime list rows now include a human-readable `employee` requester summary and backend-calculated `capabilities`. The capability predicates reuse the same requester and scoped-approval checks used by mutations. Pending own requests can be cancelled; only non-self scoped approvers can approve or reject; terminal rows expose no action capability.

## Changed paths

- `src/modules/hr/dtos/leave.dto.js`
- `src/modules/hr/dtos/overtime.dto.js`
- `src/modules/hr/services/leave.service.js`
- `src/modules/hr/services/overtime.service.js`
- `src/test/hr/dtos/timeOperations.dto.test.js`
- `src/test/hr/services/leave.service.test.js`
- `src/test/hr/services/overtime.service.test.js`

## TDD and verification

1. RED: `npx jest src/test/hr/dtos/timeOperations.dto.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/overtime.service.test.js --runInBand` failed as expected because `employee` and `capabilities` were absent.
2. GREEN: the same command passed: 3 suites, 36 tests.
3. Syntax: `node -c` passed for the four changed production files.
4. Broader check: `npx jest src/test/hr --runInBand` ran 23 suites / 158 tests successfully, but five existing route suites fail at load time because their Auth public-port mocks lack `authorizeScopedPermission`. No route or Auth files were changed in this slice.

## Commit

`858957a feat(hr): return operator-ready time records`

## Remaining split

Attendance, schedule, and employee-profile relationship summaries/capabilities remain. Fully batched department/team labels for arbitrary calendar scopes require a batched Organization public-port API; that change is outside the Task 2 HR-only allowlist. The current minimal leave/overtime slice does not add department, team, shift, or work-location enrichment.

## Task 2B completion

### Delivered

- Attendance rows expose `employee`, frozen `shift`/`workLocation` summaries, and `capabilities.adjust` from the existing adjustment authorization rule.
- Shift assignments expose batched employee, shift, and work-location summaries plus `capabilities.edit` from the assignment write rule.
- Calendar overrides expose a profile `scopeTarget` summary when applicable and `capabilities.edit` from the existing override write rules.
- Employee directory and detail responses expose department/team summaries using the existing batch Organization public port.

### Tests

RED: the focused DTO/service contract test command failed with the expected missing summary and capability fields.

GREEN:

```powershell
npx jest --runInBand src/test/hr/dtos/operatorResponse.dto.test.js src/test/hr/services/operatorResponse.service.test.js src/test/hr/services/attendance.service.test.js src/test/hr/services/schedule.service.test.js src/test/hr/services/employeeProfile.service.test.js
```

Result: 5 suites, 44 tests passed. `git diff --check` also passed.

### Commit

`14e56dd feat(hr): complete operator response contracts`

### Concerns

The existing Organization public port batches labels by account, so profile list/detail labels are complete without changing that module. Department/team calendar targets retain their typed ID summary because no existing batch Organization lookup by department/team ID is available; adding one would cross the HR-only file boundary. No leave/overtime, order/production, or frontend files are part of this slice.

## Review P2 fixes

### RED

`npx jest --runInBand src/test/hr/dtos/timeOperations.dto.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/overtime.service.test.js src/test/hr/services/schedule.service.test.js` failed as expected: leave/overtime requester rows exposed only `departmentId`/`teamId`, and DEPARTMENT, TEAM, and WORK_LOCATION calendar targets had `name: null`.

### GREEN

Leave and overtime list pages now batch the existing `organizationPublic.listAccountOrganizationSummaries` call once per request page and inject the resulting `department` and `team` summaries into each requester DTO. Calendar override pages batch department and team labels through the smallest Organization public batch port and work locations through the existing HR schedule repository batch lookup; no row-level lookups were added.

`npx jest --runInBand src/test/hr/dtos/timeOperations.dto.test.js src/test/hr/dtos/operatorResponse.dto.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/overtime.service.test.js src/test/hr/services/schedule.service.test.js src/test/hr/services/operatorResponse.service.test.js` passed: 6 suites, 56 tests.

`npx jest --runInBand src/test/hr src/test/architecture.contract.test.js` ran 26 suites / 188 tests successfully. Five existing HR route suites still fail at module load because their Auth public-port mocks do not define `authorizeScopedPermission`; this fix does not modify routes or Auth.

## Review P2 snapshot labels

Leave and overtime requester labels now batch department and team lookups using each request's immutable `requesterSnapshot.departmentId` and `requesterSnapshot.teamId`. Existing snapshot-based approval scope filters remain unchanged. Regression coverage models a transferred employee whose current Sales membership differs from the request's Operations snapshot.

RED: the two focused service tests failed with current Sales labels before the fix.

GREEN:

```powershell
npx jest --runInBand src/test/hr/dtos/timeOperations.dto.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/overtime.service.test.js
```

Result: 3 suites, 38 tests passed. `node -c` passed for both edited services and `git diff --check` passed.

## Finance Import Snapshot Resilience Task 2

### Scope

Added the exact regression contract to `src/test/e2e/financeImportSnapshotFlow.e2e.test.js`:

- A non-dry-run transaction import persists the imported fee and refund records but does not call `snapshotRepository.upsertByOrderItem`.
- Explicit `financeSnapshotService.recalculateOrderItem()` reads those imported records and uses their integer minor-unit values.
- The test verifies `customerPaidAmount: 5000`, `feeAmount: 425`, `refundAmount: 1000`, and `grossProfitAmount: 1575`.

Only the shared harness test file was changed for implementation. No production files, other tests, plans/specs, or unrelated dirty files were modified.

### Verification

Command:

```powershell
npm test -- --runInBand src/test/e2e/financeImportSnapshotFlow.e2e.test.js -t "uses imported fee"
```

Result:

```text
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        1.92 s
Ran all test suites matching src/test/e2e/financeImportSnapshotFlow.e2e.test.js with tests matching "uses imported fee".
```

The new regression test passed immediately because it verifies existing behavior. Production code was intentionally not altered.

### Concerns

None for this task. The worktree already contains unrelated dirty files and an existing modified report; those were left untouched apart from appending this report section.
