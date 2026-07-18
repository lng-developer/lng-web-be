# HR Core Phase 1 Migration Map

## Source

`C:\Users\stack\Task\lng-hr-be`

## Do Not Import

- `Account`, `Role`, `Permission`: portal `auth` owns identity and RBAC.
- `Department`, `Team`: portal `organization` owns the org hierarchy.
- `AuditLog`: portal `audit` owns activity evidence.
- Attendance, leave, overtime, payroll, SQL sync, notifications, and announcements: later phases.

## Profile Mapping

- HR `Employee.accountId` maps to portal `Account._id`.
- HR `Employee.departmentId` maps to portal `Department._id`.
- HR `Employee.teamId` maps to portal `Team._id`.
- HR `Employee.avatar` maps to `HrEmployeeProfile.avatarUrl`.

## Sensitive Fields

`baseSalary`, `allowances`, `responsibilityAllowance`, `bankAccount`, `identityCard`,
`taxIdentification`, and `socialInsuranceNumber` require the compensation permissions.
