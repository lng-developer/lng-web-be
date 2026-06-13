# Auth RBAC API Guide

Auth v1 uses account-based RBAC with scoped access assignments:

- `Account` stores only authentication data: credentials, status, token version, login metadata, and embedded refresh sessions.
- `UserProfile` stores profile data and has a unique `accountId`.
- `AccessAssignment` is the single source of truth for authorization. It assigns one role to one account inside a scope such as `team`, `department`, `shop`, `vendor`, `own`, or `global`.
- A global admin/operator is represented by an active `AccessAssignment` with `scopeType: "global"` and `scopeId: null`.
- `ScopeRegistry` stores valid scoped resources for `team`, `department`, `shop`, and `vendor`. Scoped assignments are rejected unless the target scope is registered and active.
- `Role.permissions` and `AccessAssignment.customPermissions` are ObjectId refs to `Permission`.
- Effective permissions are resolved by MongoDB aggregation from `AccessAssignment -> Role -> Permission` and returned as uppercase codes such as `ORDERS:READ`.
- `findAuthAccountById` caches resolved authorization data in Redis with key `auth:permissions:<accountId>` and TTL 300 seconds when Redis is enabled. The cached value includes `roles`, `permissions`, and `scopes`; account/profile state is still read from MongoDB.

Naming rules for new roles, permissions, access assignments, and scope registry records are defined in [RBAC_NAMING_CONVENTION.md](./RBAC_NAMING_CONVENTION.md).

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

`seed:rbac` creates baseline permissions and roles: `ADMIN`, `OPERATOR`, `TEAM_LEADER`, and `DEPARTMENT_MANAGER`.
`seed:admin` creates or repairs the bootstrap admin account and ensures it has a global `ADMIN` access assignment.

Run the server:

```bash
npm run dev
```

## Endpoints

### POST `/api/auth/register`

Creates an `OPERATOR` account, profile, and global `AccessAssignment` in one MongoDB transaction.

Requires:

```env
AUTH_REGISTER_ENABLED=true
```

Body:

```json
{
  "email": "operator@example.com",
  "password": "operator-password",
  "fullName": "Operator User"
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

Response contains `accessToken`, `refreshToken`, `account`, `profile`, global `roles`, global `permissions`, and scoped `scopes`.

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

Returns account, profile, global role codes, global permission codes, and scoped assignments.

Response also includes scoped assignments:

```json
{
  "scopes": [
    {
      "assignmentId": "507f1f77bcf86cd799439099",
      "scopeType": "team",
      "scopeId": "507f1f77bcf86cd799439088",
      "roles": ["TEAM_LEADER"],
      "permissions": ["TEAM_MEMBERS:READ"]
    }
  ]
}
```

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
- `search`: email search
- `page`: default `1`
- `limit`: default `20`, max `100`

Returns a paginated sanitized account list. Use `GET /api/auth/accounts/:accountId` for resolved access details.

#### POST `/api/auth/accounts`

Creates an account, profile, and global access assignments in one MongoDB transaction with explicit roles.

Body:

```json
{
  "email": "new.admin@lng.co",
  "password": "strong-password",
  "fullName": "New Admin",
  "roleIds": ["507f1f77bcf86cd799439012"],
  "customPermissionIds": []
}
```

Use this endpoint when an admin creates users. It writes roles through `AccessAssignment`, not through the `Account` document, so the repository aggregation can resolve permissions immediately.

#### GET `/api/auth/accounts/:accountId`

Returns account, profile, editable global access ObjectIds, resolved global role codes, resolved global permission codes, and all scoped assignments.

#### PATCH `/api/auth/accounts/:accountId/status`

Body:

```json
{
  "status": "active"
}
```

#### PATCH `/api/auth/accounts/:accountId/profile`

Body:

```json
{
  "fullName": "Operations Admin"
}
```

#### PATCH `/api/auth/accounts/:accountId/email`

Updates both `Account.email` / `Account.normalizedEmail` and `UserProfile.email` in one MongoDB transaction.

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

#### DELETE `/api/auth/accounts/:accountId`

Archives the account instead of hard deleting it.

The account `status` becomes `archived`, active refresh sessions are revoked, and account `tokenVersion` is incremented. Archived accounts cannot authenticate because auth only accepts `active` accounts.

### Scoped Access Assignments

Access assignments are the only place where account authorization is stored. Scoped assignments are used when a user has a role only inside a specific scope.

Example:

```text
TEAM_LEADER + TEAM_MEMBERS:READ + team:salesTeamId
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

#### PATCH `/api/auth/accounts/:accountId/access`

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

#### POST `/api/auth/roles`

Body:

```json
{
  "code": "SUPPORT",
  "name": "Support",
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
  "code": "ORDERS:EXPORT"
}
```

#### GET `/api/auth/permissions/:permissionId`

Returns one permission.

#### PATCH `/api/auth/permissions/:permissionId`

Body:

```json
{
  "code": "ORDERS:EXPORT"
}
```

Changing a permission invalidates auth cache for accounts using it through AccessAssignment custom permissions or through a role.

#### DELETE `/api/auth/permissions/:permissionId`

Rejected with `409 CONFLICT` if the permission is assigned directly to accounts or used by any role.

## Postman Import

Import this collection:

```text
docs/postman/LNG_Web_BE_Auth_RBAC.postman_collection.json
```

Collection variables:

- `baseUrl`: defaults to `http://localhost:3000`
- `accessToken`: set automatically after login or refresh
- `refreshToken`: set automatically after login or refresh

Recommended test order:

1. Health
2. Register Operator, only if `AUTH_REGISTER_ENABLED=true`
3. Login
4. Me
5. Refresh
6. Me
7. List Permissions
8. List Roles
9. List Accounts
10. Create Account With Role
11. Create Scope
12. Create Team Access Assignment
13. Use returned ObjectIds to test scope, assignment, account access/profile/status/password changes
14. Logout
