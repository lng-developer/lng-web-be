# Auth RBAC API Guide

Auth v1 uses account-based RBAC with scoped access assignments:

- `Account` stores only authentication data: credentials, status, token version, login metadata, and embedded refresh sessions.
- `HrEmployeeProfile` is the only employee profile source. Accounts may exist without an HR profile; clients display `Account.email` in that case and load employee details from `GET /api/hr/employee-profiles/me` when needed.
- `AccessAssignment` is the single source of truth for authorization. It assigns one role to one account inside a scope such as `team`, `department`, `shop`, `vendor`, `own`, or `global`.
- A global admin/operator is represented by an active `AccessAssignment` with `scopeType: "global"` and `scopeId: null`.
- `ScopeRegistry` stores valid scoped resources for `team`, `department`, `shop`, and `vendor`. Scoped assignments are rejected unless the target scope is registered and active.
- `Role.permissions` and `AccessAssignment.customPermissions` are ObjectId refs to `Permission`.
- `ScopedRolePermission` stores scoped role permission overrides by unique key `scopeType + scopeId + roleId`.
- Effective permissions are resolved by MongoDB aggregation from `AccessAssignment -> Role -> Permission` and returned as uppercase codes such as `ORDERS:READ`.
- `findAuthAccountById` caches resolved authorization data in Redis with key `auth:permissions:<accountId>` and TTL 300 seconds when Redis is enabled. The cached value includes `roles`, `permissions`, and `scopes`; account state is still read from MongoDB.

DTO naming:

- `scopeRegistryId` is the Auth registry record id. It is the same value as `id` on scope registry responses.
- `resourceId` is the scoped business resource id, such as `Department._id`, `Team._id`, `Shop._id`, or `Vendor._id`.
- `scopeId` is retained for backward compatibility and has the same value as `resourceId` on scoped responses.

Naming rules for new roles, permissions, access assignments, and scope registry records are defined in [RBAC_NAMING_CONVENTION.md](./RBAC_NAMING_CONVENTION.md).
Scoped role permission overrides are summarized in [RBAC_SCOPED_ROLE_PERMISSION.md](./RBAC_SCOPED_ROLE_PERMISSION.md).
For a visual department/team/shop RBAC verification flow, use [RBAC_TEST_FLOW.md](./RBAC_TEST_FLOW.md).
For real department/team management and leader-member views, use [ORGANIZATION_API.md](../organization/ORGANIZATION_API.md).

## Local Setup

Set local auth env values:

```env
JWT_ACCESS_SECRET=change-me-in-production
JWT_ACCESS_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_DAYS=30
AUTH_REGISTER_ENABLED=true
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=change-me-strong-password
```

Seed the auth foundation:

```bash
npm run seed:auth
```

Or run the seed steps separately:

```bash
npm run seed:rbac
npm run seed:admin
```

`seed:rbac` creates baseline permissions and roles: `ADMIN`, `MANAGER`, `LEADER`, and `USER`.
`seed:admin` creates or repairs the bootstrap admin account and ensures it has a global `ADMIN` access assignment.
For local visual testing, `npm run seed:auth:demo` creates demo department, team, and shop scopes.
To create the full 40-user visual dataset with employee codes `J2501`-`J2540`, run `npm run seed:auth:demo-users`.

Run the server:

```bash
npm run dev
```

## Endpoints

### POST `/api/auth/register`

Creates a `USER` account and global `AccessAssignment` in one MongoDB transaction. It does not create an HR profile.

Requires:

```env
AUTH_REGISTER_ENABLED=true
```

Body:

```json
{
  "email": "operator@example.com",
  "password": "operator-password"
}
```

### POST `/api/auth/login`

Body:

```json
{
  "email": "admin@example.com",
  "password": "change-me-strong-password"
}
```

Response contains `accessToken`, `refreshToken`, `account`, global `roles`, global `permissions`, and non-global scoped `scopes`.

### POST `/api/auth/refresh`

Rotates a refresh token. The old refresh token becomes unusable immediately.

Body:

```json
{
  "refreshToken": "<refreshToken>"
}
```

### POST `/api/auth/logout`

Revokes the supplied refresh token.

Body:

```json
{
  "refreshToken": "<refreshToken>"
}
```

### GET `/api/auth/me`

Requires:

```text
Authorization: Bearer <accessToken>
```

Returns account, global role codes, global permission codes, and non-global scoped assignments. Profile data is intentionally absent.

Response also includes scoped assignments. `scopeType: "global"` is flattened into top-level `roles` and `permissions`, so it is not repeated in `scopes`:

```json
{
  "scopes": [
    {
      "assignmentId": "507f1f77bcf86cd799439099",
      "scopeType": "team",
      "scopeId": "507f1f77bcf86cd799439088",
      "resourceId": "507f1f77bcf86cd799439088",
      "roles": ["LEADER"],
      "permissions": ["TEAM_MEMBERS:READ"]
    }
  ]
}
```

### POST `/api/auth/me/change-password`

Requires a valid Bearer token but no admin permission. This is the self-service password change endpoint.

Body:

```json
{
  "currentPassword": "CurrentPass123!",
  "newPassword": "NewPass123!"
}
```

`currentPassword` is required. `newPassword` is required and must contain at least 6 characters.

Success: `200 OK` with the safe account DTO (`id`, `email`, `status`, `mustChangePassword`, login timestamps, and record timestamps). Password hashes and salts are never returned.

Errors:

- `400 VALIDATION_ERROR`: missing or invalid fields.
- `401 AUTHENTICATION_ERROR`: current password is incorrect or the access token is invalid.
- `404 NOT_FOUND`: authenticated account no longer exists.

## Admin RBAC CRUD

All admin endpoints require:

```text
Authorization: Bearer <accessToken>
```

Read endpoints require `AUTH:READ`. Write endpoints require `AUTH:WRITE`.

### Accounts

#### GET `/api/auth/accounts`

Query:

- `status`: `active` or `inactive`
- `search`: prefix search over account email
- `roleId`: active assignment role id
- `roleCode`: active assignment role code
- `departmentId`: active department-scoped assignment `scopeId`
- `teamId`: active team-scoped assignment `scopeId`
- `page`: default `1`
- `limit`: default `20`, max `100`

Returns a paginated sanitized account list. Each item includes the account and active organization placement when available:

```json
{
  "id": "507f1f77bcf86cd799439011",
  "email": "operator@example.com",
  "status": "active",
  "access": {
    "roleIds": [],
    "customPermissionIds": []
  },
  "roles": ["LEADER"],
  "roleAssignments": [
    {
      "assignmentId": "507f1f77bcf86cd799439016",
      "roleId": "507f1f77bcf86cd799439012",
      "roleCode": "LEADER",
      "roleName": "Leader",
      "scopeType": "team",
      "scopeId": "660000000000000000000101",
      "resourceId": "660000000000000000000101"
    }
  ],
  "department": {
    "id": "660000000000000000000001",
    "name": "Operations Department",
    "code": "OPERATIONS",
    "status": "active"
  },
  "team": {
    "id": "660000000000000000000101",
    "name": "Sales Team",
    "code": "SALES",
    "status": "active"
  },
  "memberType": "member"
}
```

`access` contains editable global role and custom permission ids for the user modal. `roles` is a unique list of role codes from all active access assignments. `roleAssignments` keeps the role-to-scope detail for global and scoped assignments.

Department/team membership changes stay in the organization module. Use the organization department/team/member APIs rather than adding department/team state through Auth.

#### POST `/api/auth/accounts`

Creates an account and access assignments in one MongoDB transaction.

Body:

```json
{
  "email": "new.admin@lng.co",
  "password": "strong-password",
  "assignments": [
    {
      "roleId": "507f1f77bcf86cd799439012",
      "scopeType": "team",
      "scopeId": "660000000000000000000102",
      "customPermissionIds": []
    }
  ]
}
```

Use this endpoint when an admin creates users. It writes roles only through `AccessAssignment`, not through the `Account` document, so FE should send the intended scope for every role assignment.

#### GET `/api/auth/accounts/:accountId`

Returns account, editable global access ObjectIds, resolved global role codes, resolved global permission codes, and non-global scoped assignments.

`roles` and `permissions` contain global access only. `effectiveRoles` and `effectivePermissions` include both global access and scoped assignments:

```json
{
  "roles": [],
  "permissions": [],
  "effectiveRoles": ["USER"],
  "effectivePermissions": ["CATALOG:READ", "ORDERS:READ"],
  "scopes": [
    {
      "scopeType": "team",
      "scopeId": "660000000000000000000102",
      "resourceId": "660000000000000000000102",
      "roles": ["USER"],
      "permissions": ["CATALOG:READ", "ORDERS:READ"]
    }
  ]
}
```

#### PATCH `/api/auth/accounts/:accountId/status`

Body:

```json
{
  "status": "active"
}
```

#### PATCH `/api/auth/accounts/:accountId/email`

Updates only `Account.email`. HR `workEmail` and `personalEmail` are managed through HR endpoints.

Body:

```json
{
  "email": "renamed.admin@lng.co"
}
```

This revokes active refresh sessions and increments account `tokenVersion` so old access tokens are rejected.

#### PATCH `/api/auth/accounts/:accountId/password`

Body:

```json
{
  "password": "new-strong-password"
}
```

This rotates the password hash, revokes active refresh sessions, and increments account `tokenVersion` so old access tokens are rejected by authentication middleware.

#### POST `/api/auth/accounts/:accountId/revoke-sessions`

Requires `AUTH:WRITE`.

Revokes all active refresh sessions for the account and increments account `tokenVersion`, so existing access tokens for that account are rejected on the next authenticated request.

Response:

```json
{
  "success": true,
  "data": {
    "revoked": true,
    "account": {
      "id": "507f1f77bcf86cd799439011",
      "email": "admin@example.com",
      "status": "active"
    }
  }
}
```

#### DELETE `/api/auth/accounts/:accountId`

Archives the account instead of hard deleting it.

The account `status` becomes `archived`, active refresh sessions are revoked, and account `tokenVersion` is incremented. Archived accounts cannot authenticate because auth only accepts `active` accounts.

### Scoped Access Assignments

Access assignments are the only place where account authorization is stored. Scoped assignments are used when a user has a role only inside a specific scope.

Example:

```text
LEADER + TEAM_MEMBERS:READ + team:salesTeamId
```

This means the account can read members in the Sales team only. It does not grant access to every team.

Scope rules:

- `global`: no `scopeId`
- `own`: no `scopeId`; resolved by the target module against the current account
- `department`, `team`, `shop`, `vendor`: require `scopeId`, and the scope must exist as an active `ScopeRegistry` entry

#### GET `/api/auth/scopes`

Query:

- `scopeType`: `department`, `team`, `shop`, or `vendor`
- `scopeId`
- `status`: `active` or `inactive`
- `search`: name search
- `page`
- `limit`

#### POST `/api/auth/scopes`

Registers a scoped resource so it can be used by access assignments.

Body:

```json
{
  "scopeType": "team",
  "scopeId": "507f1f77bcf86cd799439088",
  "name": "Sales Team"
}
```

#### GET `/api/auth/scopes/:scopeRegistryId`

Returns one scope registry entry.

#### PATCH `/api/auth/scopes/:scopeRegistryId`

Only `name` and `status` are editable. `scopeType` and `scopeId` are immutable.

Body:

```json
{
  "name": "Sales Team",
  "status": "active"
}
```

Changing `status` to `inactive` is rejected while active access assignments still use the scope.

#### DELETE `/api/auth/scopes/:scopeRegistryId`

Deactivates the scope registry entry. This is rejected while active access assignments still use the scope.

#### GET `/api/auth/access-assignments`

Query:

- `accountId`
- `roleId`
- `scopeType`
- `scopeId`
- `status`: `active` or `inactive`
- `page`
- `limit`

#### POST `/api/auth/access-assignments`

Body:

```json
{
  "accountId": "507f1f77bcf86cd799439011",
  "roleId": "507f1f77bcf86cd799439012",
  "scopeType": "team",
  "scopeId": "507f1f77bcf86cd799439088",
  "customPermissionIds": []
}
```

Creates an active scoped role assignment and invalidates the account auth cache.

For `team`, `department`, `shop`, or `vendor`, the target `scopeId` must already be registered in the auth scope registry.

#### GET `/api/auth/access-assignments/:assignmentId`

Returns one assignment.

#### PATCH `/api/auth/access-assignments/:assignmentId`

Body:

```json
{
  "roleId": "507f1f77bcf86cd799439012",
  "scopeType": "team",
  "scopeId": "507f1f77bcf86cd799439088",
  "customPermissionIds": [],
  "status": "active"
}
```

All fields are optional, but at least one must be present.

#### DELETE `/api/auth/access-assignments/:assignmentId`

Deactivates the assignment instead of hard deleting it.

### Scoped Role Permission Overrides

Use scoped role permission overrides when one role should have a different permission set inside one registered scope.

Canonical endpoints:

- `GET /api/auth/scoped-role-permissions`
- `PUT /api/auth/scoped-role-permissions`

Query:

- `scopeType`: `department`, `team`, `shop`, or `vendor`
- `scopeId`
- `roleId`
- `page`
- `limit`

Response items include both the Auth registry id and the business resource id:

```json
{
  "id": "507f1f77bcf86cd799439077",
  "scopeRegistryId": "507f1f77bcf86cd799439077",
  "scopeType": "team",
  "scopeId": "507f1f77bcf86cd799439088",
  "resourceId": "507f1f77bcf86cd799439088",
  "name": "Sales Team",
  "status": "active"
}
```

PUT body:

```json
{
  "scopeType": "team",
  "scopeId": "507f1f77bcf86cd799439088",
  "roleId": "507f1f77bcf86cd799439012",
  "permissionIds": ["507f1f77bcf86cd799439013"]
}
```

Department-scoped rules use the same canonical endpoint with `scopeType: "department"` and `scopeId` set to the department id.

#### PATCH `/api/auth/accounts/:accountId/access`

Replaces active global assignments only. Scoped assignments are managed with `/api/auth/access-assignments/:assignmentId`.

Body:

```json
{
  "roleIds": ["507f1f77bcf86cd799439012"],
  "customPermissionIds": ["507f1f77bcf86cd799439013"]
}
```

The service validates every ObjectId, writes only through repositories, and invalidates Redis auth cache for the account.

This endpoint replaces the account's active global assignments. It does not write role or permission fields to the `Account` document.

### Roles

#### GET `/api/auth/roles`

Query:

- `search`
- `page`
- `limit`

Each role response includes:

- `description`
- `userCount`: number of active access assignments using the role
- `deletable`: `true` only when `userCount` is `0`

#### POST `/api/auth/roles`

Body:

```json
{
  "code": "SUPPORT",
  "name": "Support",
  "description": "Support role.",
  "permissionIds": ["507f1f77bcf86cd799439013"]
}
```

#### GET `/api/auth/roles/:roleId`

Returns one role.

#### PATCH `/api/auth/roles/:roleId`

Body:

```json
{
  "name": "Senior Support",
  "description": "Senior support role.",
  "permissionIds": ["507f1f77bcf86cd799439013"]
}
```

Changing a role invalidates auth cache for accounts using that role.

#### POST `/api/auth/roles/:roleId/permissions`

Adds one permission to a role without replacing the full permission list.

Body:

```json
{
  "permissionId": "507f1f77bcf86cd799439013"
}
```

Uses an atomic `$addToSet`, so sending the same permission twice does not duplicate it. This invalidates auth cache for accounts using the role.

#### DELETE `/api/auth/roles/:roleId/permissions/:permissionId`

Removes one permission from a role without replacing the full permission list.

This invalidates auth cache for accounts using the role.

#### DELETE `/api/auth/roles/:roleId`

Rejected with `409 CONFLICT` if the role is assigned to any account.

### Permissions

#### GET `/api/auth/permissions`

Query:

- `search`
- `page`
- `limit`

#### POST `/api/auth/permissions`

Body:

```json
{
  "code": "ORDERS:EXPORT",
  "name": "Export orders",
  "description": "Allows exporting order data."
}
```

#### GET `/api/auth/permissions/:permissionId`

Returns one permission.

#### PATCH `/api/auth/permissions/:permissionId`

At least one field is required. Use this endpoint to update the permission code, display name, description, or any combination of those fields.

Body:

```json
{
  "code": "ORDERS:EXPORT",
  "name": "Export orders",
  "description": "Allows exporting order data."
}
```

Changing a permission invalidates auth cache for accounts using it through AccessAssignment custom permissions or through a role.

#### DELETE `/api/auth/permissions/:permissionId`

Rejected with `409 CONFLICT` if the permission is assigned directly to accounts or used by any role.

## Postman Import

Import this collection:

```text
docs/auth/postman/LNG_Web_BE_Auth_RBAC.postman_collection.json
```

Collection variables:

- `baseUrl`: defaults to `http://localhost:3000`
- `accessToken`: set automatically after login or refresh
- `refreshToken`: set automatically after login or refresh

Recommended test order:

1. Run `npm run seed:auth:demo-users` for the full local visual dataset, or `npm run seed:auth` for admin-only RBAC.
2. Run `npm run dev`.
3. In Postman, run folder `00 Happy Flow - Seeded Demo` from top to bottom.
4. Use `02 Accounts`, `03 Scope Registry`, `04 Access Assignments`, `05 Roles`, `06 Permissions`, and `07 Scoped Role Permission Overrides` for focused CRUD testing.
5. Use `08 Optional Write Flow - Scoped Account` only for disposable write testing.
6. Use `09 Demo Scoped RBAC Builders` only when you want to create extra scoped demo accounts manually.
7. Use `10 Organization Helpers` to inspect department/team membership data that Auth uses for account list enrichment.
