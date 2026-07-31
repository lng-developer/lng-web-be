# HR Demo Profile Seed Design

## Goal

Make the repository's isolated demo seed chain produce the HR profiles required by Organization and RBAC integration tests without writing to the development database.

## Scope

- Add a top-level orchestration script at `src/scripts/seedHrDemoProfiles.js`.
- Reuse `buildDemoUsers()` from the Auth demo seed as the canonical demo-person list.
- Extend that canonical list with generated `USER` definitions for every Sales and Design team member required by `seed:organization:demo`; preserve the existing named personas and permission overrides.
- Resolve each demo `Account` by its generated email and idempotently upsert one `HrEmployeeProfile` by `accountId`.
- Add `seed:hr:demo-profiles` and insert it between Auth and Organization in `seed:demo:full`.
- Update the RBAC integration fixture from legacy `ADMIN` to canonical `SUPER_ADMIN`.

The change will not seed payroll, attendance, salary, personal email, identity, banking, or other sensitive HR data. It will not modify the development database during verification.

## Data Contract

Each profile uses the existing Auth demo definition:

- `accountId`: resolved from the demo Account.
- `employeeCode`: the definition's `employeeCode`.
- `fullName`: the definition's human-readable `title`.
- `jobTitle`: the definition's `title`.
- `workEmail`: the demo Account email.
- `status`: active.
- `employmentType`: full-time.
- `workMode`: onsite.
- `isDeleted`: false.

Department and team ownership remains with `seed:organization:demo`; this seed leaves `departmentId` and `teamId` unset.

The canonical Auth list includes `J2506-J2509` and `J2514-J2522` in the Sales team, plus `J2510-J2513` and `J2523-J2530` in the Design team. Missing members use role `USER` with the normal scoped-role permissions; explicitly defined leader/operator/QC/CS personas keep their existing roles and overrides.

## Boundaries

The script lives under `src/scripts/` because it orchestrates Auth-owned Account data and HR-owned EmployeeProfile data. Neither module will import the other's private model from production services. Existing module behavior and public APIs remain unchanged.

## Failure Handling

The script fails before writing profiles if any expected demo Account is missing. Profile writes use upsert semantics and schema validation. A second run must update/reuse the same profiles rather than create duplicates.

## Verification

1. A focused Jest test proves payload mapping, missing-account failure, and idempotent upsert filters.
2. Seed the isolated `lng_web_be_auth_test` database only.
3. Run `seed:organization:demo` and `seed:shop:demo` against the isolated database.
4. Run the gated RBAC MongoDB integration suite against the isolated database.
5. Run the complete Auth test script.
