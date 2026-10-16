# Portal and HR RBAC audit and rollout scope

Status: read-only code audit and proposed policy; no production changes. HR observations below refer to fetched origin/develop, not a live payroll penetration test.

## Existing behavior to preserve

- leave.service.js and overtime.service.js reject requester self-approval and validate the current approval-chain actor. Scoped checks use requesterSnapshot team/department.
- employeeProfile.service.js separates compensation access from ordinary employee access; sensitive reads currently require global compensation permission.
- payroll.service.js has independent READ, WRITE, FINALIZE and PAY capabilities; personal payroll uses account-specific results.
- FE hrNavigation.ts already separates self, team, operations and payroll workspaces.
- Employee profile team changes invoke organization membership synchronization. Organization in turn assigns generic LEADER/USER, so permission redesign must include both paths.

## Findings and required verification

1. Generic LEADER combines Portal and HR rights. Preserve team HR capabilities while replacing unrelated Portal rights; changing only DESIGN_LEADER cannot remove additive LEADER rights.
2. Payroll routes accept scoped READ through authorizeAnyPermission. getPayrollRun loads all results by run without the scope resolver used by listPayrollResults/getPayrollResult/exportPayrollResults. Add a real route/service negative regression before granting scoped payroll access. Do not return employee salary details from a scoped run view without filtering.
3. Leave/overtime access uses historical requesterSnapshot; profile/team changes use current membership. Define transfer behavior explicitly: do not silently move pending approvals or erase historical evidence.
4. Compensation permissions currently differ from scoped payroll visibility. Document and test the distinction, including CSV and profile DTO redaction.
5. UI permissions do not replace server scope checks. Verify deep links, lists, details, attachments, exports and write actions independently.

## Proposed combined matrix

| Capability | Employee | Team leader | HR operations | Payroll operator | Payroll manager |
| --- | --- | --- | --- | --- | --- |
| Own profile, attendance, requests, released payroll | Own | Own | Own | Own | Own |
| Team schedule/attendance/basic directory | No | Assigned teams | Authorized scope | No by default | No by default |
| Approve leave/overtime | No | Assigned teams, never self | Explicit approver scope/chain | No | No |
| Correct attendance | No | No by default | Explicit MANAGE | No | No |
| Employee administration | No | No by default | Explicit WRITE and scope | No | No |
| Compensation | Own approved personal view only | No team salary by default | Separate explicit permission | Explicit payroll scope | Explicit payroll scope |
| Calculate payroll | No | No | No by default | WRITE | WRITE if granted |
| Finalize/pay payroll | No | No | No | No | FINALIZE/PAY separately |

System admin is not automatically payroll/compensation admin; SUPER_ADMIN remains a documented exceptional principal. Existing operations using broad roles require impact review, not silent revocation.

## Rollout order

- [ ] Pin current behaviors with tests: real LEADER/DESIGN_LEADER codes; self-approval denied; cross-team reads denied; salary DTO/export redaction; scoped run details; member transfer; old pending approval chain; multiple teams; inactive grants/cache refresh.
- [ ] Fix data-scope gaps in Design and Payroll before expanding any role grants.
- [ ] Separate team HR capabilities from Portal job roles, reusing existing assignments rather than creating another membership system.
- [ ] Update organization/profile team-change synchronization with audited grant/revoke behavior; never strip unrelated assignments.
- [ ] Align FE Portal and HR menus and action capabilities with BE policies.
- [ ] Produce dry-run per-account before/after permissions and scope report; preserve HR self-service and leader HR capabilities.
- [ ] Review migration with user, then run separately authorized migration with rollback evidence and readback.

## Policy decisions still required before broad migration

- Pending requests after a team transfer: retain historical approval chain or explicitly reroute with audit.
- Whether team leaders can edit team schedules/calendar or only view them.
- Who receives compensation READ/WRITE, payroll FINALIZE and payroll PAY; no inferred recipients.

## Verification so far

- 63 tests passed: leave.service.test.js and overtime.service.test.js.
- Initial npm test command rejected combined maxWorkers/runInBand; rerun directly through installed Jest succeeded.
- No production salary data was read and no approval/payroll operation was performed.

The design-team-listing-access plan remains a bounded subproject, not the complete RBAC redesign.
