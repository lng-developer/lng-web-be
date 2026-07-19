# Task 1 Implementation Report

## Scope

Modified only the seven HR source/test files named in the task brief, plus this report. No order, production, or pre-existing dirty files were changed or staged.

## TDD Evidence

1. Added the required profile regression: a department-scoped `HR_EMPLOYEES:READ` actor requests an employee profile belonging to another department.
2. Added the required schedule regression: a department-scoped `HR_SCHEDULE:WRITE` actor attempts to create a global shift.
3. Red command:

   ```powershell
   npx jest --runInBand src/test/hr/services/employeeProfile.service.test.js src/test/hr/services/schedule.service.test.js
   ```

   Result: both new tests failed because each service resolved successfully instead of rejecting. This demonstrated the missing target-profile scope check and missing global schedule-writer check.
4. Added a `baseCurrency` assertion to the existing sensitive detail test. The focused employee suite then failed with `Received: "VND"`, proving the field was still exposed without explicit sensitive-detail access.
5. Implemented the minimal shared-service and route guards, then reran the two focused suites.

## Implementation

- Employee profile reads now derive team/department filters from the caller's employee permissions, apply those filters in the repository before list results are returned, and reject out-of-scope profile details with `AUTHORIZATION_ERROR`.
- Profile lists use a directory DTO. It excludes personal contact fields, birth date, address, emergency contact, contract fields, dependants, compensation, and `baseCurrency`.
- Profile detail uses the detailed DTO. Compensation fields, including `baseCurrency`, are selected and serialized only when the existing compensation permission permits sensitive data.
- `/employee-profiles/me` remains self-service and now selects/returns sensitive compensation fields only for callers with compensation read or write permission.
- Shift and work-location create/update routes require a global schedule writer. Their services enforce the same boundary for direct callers.
- Schedule assignment reads/writes validate the target employee's department/team scope. Calendar override writes validate global, team, department, or profile ownership before mutation; scoped calendar reads return only global and caller-visible overrides.

## Verification

```powershell
npx jest --runInBand src/test/hr/services/employeeProfile.service.test.js src/test/hr/services/schedule.service.test.js
```

Result: PASS - 2 suites, 14 tests, 0 failures.

`git diff --check` also passed with no whitespace errors.

## Known Constraint

Scoped schedule assignment and calendar-override lists filter the repository page in the service because `schedule.repository.js` is outside the task's allowed file list. Returned rows and reported totals are scope-safe, but a page containing only out-of-scope rows can be sparse even when matching records exist on a later global page. Exact cross-page scoped pagination requires repository-level scope filtering in a follow-up task.
