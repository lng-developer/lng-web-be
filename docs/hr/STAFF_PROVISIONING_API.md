# Staff provisioning and self-onboarding API

Base path: `/api`. All successful responses use `{ "success": true, "data": ... }`.

## 1. HR provisions a staff member

`POST /api/hr/staff-provisioning`

Requires a bearer token with `HR_EMPLOYEES:WRITE` in an authorized scope. The server resolves the submitted department/team and validates that the caller can manage that scope.

```json
{
  "employeeCode": "J2501",
  "workEmail": "jane.nguyen@company.example",
  "fullName": "Jane Nguyen",
  "departmentId": "660000000000000000000002",
  "teamId": "660000000000000000000003",
  "jobTitle": "Operations Specialist",
  "jobLevel": "L2",
  "employmentType": "FULL_TIME",
  "workMode": "ONSITE",
  "startDate": "2026-08-01",
  "probationEndDate": "2026-10-30",
  "status": "PROBATION",
  "assignments": [
    {
      "roleId": "660000000000000000000005",
      "scopeType": "department",
      "scopeId": "660000000000000000000002",
      "customPermissionIds": [],
      "overridePermissionIds": null
    }
  ]
}
```

`workEmail` becomes the Auth account email. `employeeCode` belongs to the HR profile; it is not an Auth login credential in this API. The request deliberately has **no password field**. The Auth module creates the active account with the server-owned initial password `123456` and `mustChangePassword: true`.

The operation is one MongoDB transaction. It creates the account, access assignments, company-owned HR profile, the current-year `ANNUAL` leave-balance record, and required audit records together. A failure rolls the whole operation back.

```json
{
  "success": true,
  "data": {
    "accountId": "660000000000000000000001",
    "profile": {
      "id": "660000000000000000000004",
      "employeeCode": "J2501",
      "fullName": "Jane Nguyen",
      "workEmail": "jane.nguyen@company.example",
      "departmentId": "660000000000000000000002",
      "teamId": "660000000000000000000003",
      "jobTitle": "Operations Specialist",
      "jobLevel": "L2",
      "employmentType": "FULL_TIME",
      "workMode": "ONSITE",
      "startDate": "2026-08-01T00:00:00.000Z",
      "probationEndDate": "2026-10-30T00:00:00.000Z",
      "status": "PROBATION"
    },
    "mustChangePassword": true,
    "isProfileUpdated": false,
    "leaveBalance": { "year": 2026, "leaveType": "ANNUAL" }
  }
}
```

`400 VALIDATION_ERROR` indicates an invalid body; `403 AUTHORIZATION_ERROR` means the caller lacks the HR permission/scope; `409 CONFLICT_ERROR` covers duplicate account email or employee profile fields.

### Assignable role catalog

`GET /api/hr/staff-provisioning/roles` requires the same `HR_EMPLOYEES:WRITE` permission. It returns only roles the caller may assign (non-super-admin callers cannot receive `SUPER_ADMIN`):

```json
{
  "success": true,
  "data": [
    {
      "id": "660000000000000000000005",
      "name": "Operator",
      "description": "Handles daily operations"
    }
  ]
}
```

Role codes and permission details are intentionally not returned by this catalog.

## 2. Staff changes the initial password

`POST /api/auth/me/change-password` requires a bearer token.

```json
{
  "currentPassword": "123456",
  "newPassword": "A-new-password"
}
```

`newPassword` must contain at least six characters. The endpoint verifies `currentPassword`, clears `mustChangePassword`, increments the token version, and revokes active refresh sessions. It returns a safe account DTO only; the client must sign in again to obtain a replacement session.

```json
{
  "success": true,
  "data": {
    "id": "660000000000000000000001",
    "email": "jane.nguyen@company.example",
    "status": "ACTIVE",
    "mustChangePassword": false,
    "lastLoginAt": null,
    "lastLoginIp": null,
    "createdAt": "2026-08-01T00:00:00.000Z",
    "updatedAt": "2026-08-01T00:00:00.000Z"
  }
}
```

An invalid current password returns `401 AUTHENTICATION_ERROR`; malformed input returns `400 VALIDATION_ERROR`.

## 3. Staff completes their own personal profile

`GET /api/hr/employee-profiles/me` returns the authenticated employee's personal-safe profile. `PATCH /api/hr/employee-profiles/me/personal` updates only that same profile; neither endpoint requires an HR role.

The completion request requires `phoneNumber`, `address`, `personalEmail`, and `emergencyContact.name`, `emergencyContact.phone`, and `emergencyContact.relation`. It may also include `avatarUrl`, `gender`, `birthDate`, `dependantDetails`, `identityCard`, `taxIdentification`, `socialInsuranceNumber`, and `bankAccount`.

```json
{
  "phoneNumber": "+84 901 234 567",
  "address": "District 1, Ho Chi Minh City",
  "personalEmail": "jane.personal@example.com",
  "emergencyContact": {
    "name": "Nguyen Van A",
    "phone": "+84 902 345 678",
    "relation": "Parent"
  },
  "bankAccount": {
    "bankName": "Example Bank",
    "accountNumber": "0123456789"
  }
}
```

Company/access/compensation fields—including `employeeCode`, `workEmail`, `departmentId`, `teamId`, `jobTitle`, `employmentType`, `status`, `assignments`, `baseSalary`, and allowances—are rejected with `400 VALIDATION_ERROR`. A successful PATCH sets `isProfileUpdated: true`, returns the personal-safe profile, and records an audit event without copying PII values into audit metadata.

## Onboarding state and setup gate

Directory and profile detail DTOs expose `onboardingStatus`:

- `PROFILE_INCOMPLETE` when `isProfileUpdated` is false.
- `READY` when `isProfileUpdated` is true.

`GET /api/auth/me` includes `account.mustChangePassword` and `profileSetupRequired`. `profileSetupRequired` is true for an authenticated account with an HR profile whose `isProfileUpdated` is false.

While either flag is true, all protected business requests fail with `403 ACCOUNT_SETUP_REQUIRED` except these setup actions:

- `GET /api/auth/me`
- `POST /api/auth/me/change-password`
- `GET /api/hr/employee-profiles/me`
- `PATCH /api/hr/employee-profiles/me/personal`
- `POST /api/auth/logout`

The API allowlist does not enforce an endpoint order; the web client should present password change before profile completion. A missing/invalid bearer token returns `401 AUTHENTICATION_ERROR`; ordinary authorization failures remain `403 AUTHORIZATION_ERROR`.
