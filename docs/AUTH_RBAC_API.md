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
7. Logout
