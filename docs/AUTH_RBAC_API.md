# Auth RBAC API Guide

Auth v1 uses account-based RBAC:

- `Account` stores credentials, status, role ObjectIds, custom permission ObjectIds, and embedded refresh sessions.
- `UserProfile` stores profile data and has a unique `accountId`.
- `Role.permissions` and `Account.customPermissions` are ObjectId refs to `Permission`.
- Effective permissions are resolved by MongoDB aggregation and returned as flat uppercase codes such as `ORDERS:READ`.
- `findAuthAccountById` caches only resolved permission codes in Redis with key `auth:permissions:<accountId>` and TTL 300 seconds when Redis is enabled.

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

Seed RBAC foundation first:

```bash
npm run seed:rbac
```

Then create the bootstrap admin:

```bash
npm run seed:admin
```

Run the server:

```bash
npm run dev
```

## Endpoints

### POST `/api/auth/register`

Creates an `OPERATOR` account and profile in one MongoDB transaction.

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

Response contains `accessToken`, `refreshToken`, `account`, `profile`, `roles`, and `permissions`.

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

Returns account, profile, role codes, and flat permission codes.

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

Returns sanitized accounts plus editable `access.roleIds` and `access.customPermissionIds`.

#### POST `/api/auth/accounts`

Creates an account and profile in one MongoDB transaction with explicit roles.

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

Use this endpoint when an admin creates users. It avoids the extra step of registering an `OPERATOR` user and then changing access afterward.

#### GET `/api/auth/accounts/:accountId`

Returns account, profile, editable access ObjectIds, resolved role codes, and resolved permission codes.

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

#### PATCH `/api/auth/accounts/:accountId/access`

Body:

```json
{
  "roleIds": ["507f1f77bcf86cd799439012"],
  "customPermissionIds": ["507f1f77bcf86cd799439013"]
}
```

The service validates every ObjectId, writes only through repositories, and invalidates Redis permission cache for the account.

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

Changing a role invalidates permission cache for accounts using that role.

#### POST `/api/auth/roles/:roleId/permissions`

Adds one permission to a role without replacing the full permission list.

Body:

```json
{
  "permissionId": "507f1f77bcf86cd799439013"
}
```

Uses an atomic `$addToSet`, so sending the same permission twice does not duplicate it. This invalidates permission cache for accounts using the role.

#### DELETE `/api/auth/roles/:roleId/permissions/:permissionId`

Removes one permission from a role without replacing the full permission list.

This invalidates permission cache for accounts using the role.

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

Changing a permission invalidates permission cache for accounts using it directly or through a role.

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
11. Use returned ObjectIds to test account access/profile/status/password changes
12. Logout
