# Task 2: Design Submission Scoring Service

## Scope

- Added the score service and response DTO.
- Reused `auth/public.js`, `organization/public.js`, and the Task 1 score repository.
- Did not modify organization, routes, controllers, DesignTask, dependencies, or unrelated worktree files.

## RED Evidence

Command:

```powershell
npm test -- src/test/design/services/designSubmissionScore.service.test.js --runInBand
```

Exit code: `1`

```text
> lng-web-be@1.0.0 test
> jest src/test/design/services/designSubmissionScore.service.test.js --runInBand

FAIL src/test/design/services/designSubmissionScore.service.test.js
  Test suite failed to run

    Cannot find module '../../../modules/design/services/designSubmissionScore.service' from 'src/test/design/services/designSubmissionScore.service.test.js'

      19 | const organizationPublic = require('../../../modules/organization/public');
      20 | const repository = require('../../../modules/design/repositories/designSubmissionScore.repository');
    > 21 | const service = require('../../../modules/design/services/designSubmissionScore.service');
         |                 ^
      22 |
      23 | const id = () => new mongoose.Types.ObjectId();
      24 |

      at Resolver._throwModNotFoundError (node_modules/jest-resolve/build/index.js:895:11)
      at Object.require (src/test/design/services/designSubmissionScore.service.test.js:21:17)

Test Suites: 1 failed, 1 total
Tests:       0 total
Snapshots:   0 total
Time:        0.815 s
Ran all test suites matching src/test/design/services/designSubmissionScore.service.test.js.
```

## GREEN Evidence

First implementation run:

```text
> lng-web-be@1.0.0 test
> jest src/test/design/services/designSubmissionScore.service.test.js --runInBand

Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
Snapshots:   0 total
Time:        3.064 s
Ran all test suites matching src/test/design/services/designSubmissionScore.service.test.js.
```

Final focused run after the score-rule matrix and cleanup:

```powershell
npm test -- src/test/design/services/designSubmissionScore.service.test.js --runInBand
```

Exit code: `0`

```text
> lng-web-be@1.0.0 test
> jest src/test/design/services/designSubmissionScore.service.test.js --runInBand

Test Suites: 1 passed, 1 total
Tests:       21 passed, 21 total
Snapshots:   0 total
Time:        1.247 s, estimated 3 s
Ran all test suites matching src/test/design/services/designSubmissionScore.service.test.js.
```

Syntax checks:

```powershell
node -c src/modules/design/services/designSubmissionScore.service.js
node -c src/modules/design/dtos/designSubmissionScore.dto.js
```

Exit code: `0`

Architecture contract:

```powershell
npm run test:architecture -- --runInBand
```

Exit code: `0`

```text
> lng-web-be@1.0.0 test:architecture
> jest src/test/architecture.contract.test.js --runInBand

Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
Snapshots:   0 total
Time:        4.924 s
Ran all test suites matching src/test/architecture.contract.test.js.

## Review P2 fixes

RED: `npx jest --runInBand src/test/hr/dtos/timeOperations.dto.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/overtime.service.test.js src/test/hr/services/schedule.service.test.js` failed as expected because requester organization labels and non-profile calendar target labels were absent.

GREEN: leave and overtime list pages batch `organizationPublic.listAccountOrganizationSummaries` once per page and inject `department` and `team` summaries. Calendar pages batch department/team labels through Organization public and work locations through the existing HR schedule repository; no row-level lookups were added.

`npx jest --runInBand src/test/hr/dtos/timeOperations.dto.test.js src/test/hr/dtos/operatorResponse.dto.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/overtime.service.test.js src/test/hr/services/schedule.service.test.js src/test/hr/services/operatorResponse.service.test.js` passed: 6 suites, 56 tests.

`npx jest --runInBand src/test/hr src/test/architecture.contract.test.js` ran 26 suites / 188 tests successfully. Five existing HR route suites still fail at module load because their Auth public-port mocks do not define `authorizeScopedPermission`; this fix does not modify routes or Auth.
```

## Coverage

- All five default task-type point rules, including HIGH and URGENT multipliers.
- Inactive, missing-submitter, missing-submission-ID, and missing-task-ID score guards.
- Profile and first active organization snapshot persistence.
- Override zero, negative/reason validation, and inactive-score failure.
- Void reason validation, inactive-score failure, and immutable final points.
- Summary DTO ID mapping without raw documents.

## Task 2 Review Fix Evidence

Finding: `Number(null) === 0` allowed a null override points value to reach the repository as a zero-point override.

### RED

Added focused cases for `null`, `''`, and whitespace-only `points` to `src/test/design/services/designSubmissionScore.service.test.js`.

Command:

```powershell
npm test -- src/test/design/services/designSubmissionScore.service.test.js --runInBand
```

Result: exit code `1`; all three new cases resolved instead of rejecting and reached `repository.overrideScore` with `finalPoints: 0`. The existing 21 cases passed.

### GREEN

Updated `overrideSubmissionScore` to reject null, undefined, and blank string input before numeric conversion. Numeric zero remains valid.

Command:

```powershell
npm test -- src/test/design/services/designSubmissionScore.service.test.js --runInBand
```

Result: exit code `0`; `Test Suites: 1 passed, 1 total`; `Tests: 24 passed, 24 total`.

Syntax checks also passed:

```powershell
node -c src/modules/design/services/designSubmissionScore.service.js
node -c src/test/design/services/designSubmissionScore.service.test.js
```
