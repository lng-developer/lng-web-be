# LNG HR identity migration apply report

## Scope and safety

- Source: `lng_hr` (read-only during planning).
- Target: `lng_web_be`.
- Missing accounts are created as `inactive` with a random one-way credential. Legacy password hashes are never copied or logged.
- Existing target account status, password, and sessions are not overwritten.
- Accounts, `HrEmployeeProfile`, departments, teams, memberships, and RBAC assignments are idempotent upserts.
- Apply performs an identity preflight before the first write and aborts if any employee is skipped or failed.
- Department/team codes are resolved to the actual target document IDs before identity planning. A source `_id` already owned by another target code aborts apply before any write.
- Only Active/Probation employees receive active RBAC assignments and team memberships. Resigned/deleted history keeps its profiles but active assignments are deactivated.
- Moving a team membership is one Mongo transaction; a failed replacement rolls back the old active membership and reports the source employee row.
- A planned source Account `_id` already owned by another target email is reported as `SOURCE_ACCOUNT_ID_COLLISION` during the read-only preflight.

## Audited legacy role map

| Legacy role | POD assignment | Scope | Notes |
| --- | --- | --- | --- |
| `ADMIN` | `ADMIN` | global | Marked `elevated: true` in every row report. This is the only legacy role allowed to receive POD `ADMIN`. |
| `DIRECTOR` | `MANAGER` | global | Uses the HR-only permission override below; receives no unrelated commerce permissions. |
| `HR` | `MANAGER` | global | Uses the HR-only permission override below; receives no unrelated commerce permissions. |
| `MANAGER` | `MANAGER` plus `USER` | department plus current team/own | Department is mandatory; a missing department is skipped as `MISSING_ROLE_SCOPE`. |
| `LEADER` | `LEADER` plus `USER` | current team | Team is mandatory; a missing team is skipped as `MISSING_ROLE_SCOPE`. |
| `EMPLOYEE` | `USER` | current team, otherwise own | Explicit fallback; no guessed department/team. |

The `HR` and `DIRECTOR` override is limited to:

`AUTH:READ`, `AUTH:WRITE`, `AUDIT:READ`, `DEPARTMENTS:READ`, `DEPARTMENTS:WRITE`,
`TEAMS:READ`, `TEAMS:WRITE`, `REPORTS:READ`, all current `HR_EMPLOYEES`,
`HR_COMPENSATION`, `HR_SCHEDULE`, `HR_ATTENDANCE`, `HR_LEAVE`, `HR_OVERTIME`,
`HR_CALENDAR`, `HR_PAYROLL`, `HR_ANNOUNCEMENTS`, and `HR_INTEGRATIONS` permissions.

Unknown legacy roles, missing target roles/permissions, missing mandatory scopes, and conflicting email/employee-code matches are reported and never guessed.

## Live dry-run evidence (2026-07-27)

The focused migration suite, Auth suite, Organization suite, and architecture contract pass. No database write was executed.

| Dataset | Read | Mapped | Skipped | Failed |
| --- | ---: | ---: | ---: | ---: |
| Accounts | 52 | 41 | 11 | 0 |
| Active/Probation identities | 41 | 31 | 10 | 0 |
| Departments | 7 | 7 | 0 | 0 |
| Teams | 7 | 7 | 0 | 0 |
| Team memberships | 52 | 29 | 23 | 0 |
| HrEmployeeProfile | 52 | 41 | 11 | 0 |

Every reported dataset now satisfies `read = mapped + skipped`. The complete dry-run also reconciles leave, attendance, overtime, payroll, announcements, notifications, and SQL sync rows.

Current identity blockers:

- 9 `AMBIGUOUS_TARGET_ACCOUNT`: source email and employee code point to different target accounts. These require explicit account choices; the migration does not choose one.
- 2 `TARGET_PERMISSION_NOT_FOUND`: employees `J2607` and `J2628` both map from legacy `HR` to `MANAGER/global` with the HR-only override. Target RBAC is missing `HR_ANNOUNCEMENTS:READ`, `HR_ANNOUNCEMENTS:WRITE`, `HR_CALENDAR:READ`, `HR_CALENDAR:WRITE`, `HR_INTEGRATIONS:MANAGE`, `HR_PAYROLL:FINALIZE`, `HR_PAYROLL:PAY`, `HR_PAYROLL:READ`, and `HR_PAYROLL:WRITE`.

The sanitized candidate details and empty decision slots are in `docs/hr/lng-hr-identity-ambiguity-manifest.json`.

The 41 currently mapped rows would produce 9 new inactive accounts and update 32 existing identities. These are planning effects only; apply is currently blocked.

The 23 non-active membership rows are explicit: 11 identities blocked above, 10 inactive historical employees, and 2 active identities without a mapped team. No inactive historical employee receives active access.

## Apply preconditions

1. Back up target Auth, Organization, and HR collections.
2. Run the current idempotent RBAC seed against `lng_web_be`, then dry-run again.
3. Resolve all 9 ambiguous account rows with an explicit reviewed target account decision.
4. Require `accounts.activeOrProbationSkipped = 0`, `skipped = 0`, and `failed = 0`.
5. Require every dataset to satisfy `read = mapped + skipped`; review all downstream skip reason totals.
6. Only then run `npm run migrate:hr:lng-hr -- --apply`, followed by the same dry-run to prove idempotency.
