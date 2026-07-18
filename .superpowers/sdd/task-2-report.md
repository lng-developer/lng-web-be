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
```

## Coverage

- All five default task-type point rules, including HIGH and URGENT multipliers.
- Inactive, missing-submitter, missing-submission-ID, and missing-task-ID score guards.
- Profile and first active organization snapshot persistence.
- Override zero, negative/reason validation, and inactive-score failure.
- Void reason validation, inactive-score failure, and immutable final points.
- Summary DTO ID mapping without raw documents.
