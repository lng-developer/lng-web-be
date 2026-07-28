# Legacy HR parity matrix

| ID | Legacy entrypoint | Target owner | Evidence | Gate |
| --- | --- | --- | --- | --- |
| employees | `/api/employees` | hr | employee route contract; migration counts | required before cutover |
| shifts | `/api/shifts` | hr | shift route contract | required before cutover |
| holidays | `/api/holidays`; holiday attendance repair | hr | holiday precedence cases | required before cutover |
| saturday-rotations | `/api/saturday-rotations` | hr | rotation schedule cases | required before cutover |
| attendance | `/api/attendances`; reconciliation | hr | legacyAttendanceResolutionCases | required before cutover |
| sql-attendance-worker | `/api/sql-server`; sql-attendance-worker | integration | cursor and idempotency tests | required before cutover |
| leaves | `/api/leaves`; leave attendance sync | hr | leave lifecycle cases | required before cutover |
| leave-balances | `/api/leave-balances`; accrual, reset, carry-over | hr | balance lifecycle cases | required before cutover |
| overtime | `/api/overtimes` | hr | overtime lifecycle cases | required before cutover |
| payroll | `/api/payrolls` | hr | per-employee shadow diff | required before cutover |
| payroll-adjustments | `/api/payroll-adjustments` | hr | adjustment lifecycle cases | required before cutover |
| payroll-email | payroll email worker | hr | deduplicated email job tests | required before cutover |
| notifications | `/api/notifications` | notification | inbox and retry tests | required before cutover |
| announcements | `/api/announcements`; announcement publish and reminder | hr | visibility and recipient tests | required before cutover |
| dashboard | `/api/dashboard` | hr | DTO aggregate tests | required before cutover |
| office-networks | `/api/office-networks` | integration | trusted network validation tests | required before cutover |
| system-settings | `/api/system-settings` | hr | explicit setting mapping | required before cutover |
