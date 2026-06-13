# RBAC Test Flow

Use this flow to verify that global RBAC and scoped RBAC work across department, team, and shop scopes.

## 1. Seed Auth Demo Data

To seed only the admin foundation and demo scopes, run:

```bash
npm run seed:auth:demo
```

This runs the base auth seed and creates demo scope registry records.

To seed the full visual RBAC dataset with 40 demo users, run:

```bash
npm run seed:demo:full
```

Demo user password:

```text
Demo@123456
```

The demo user seed creates employee codes from `J2501` to `J2540`.

`npm run seed:demo:full` also creates demo Shop records for the shop scopes. Use `npm run seed:shop:demo` to refresh only shop records and matching Auth `ScopeRegistry` entries.

Demo scopes:

| Scope Type | Scope Name | Scope ID |
|---|---|---|
| department | Operations Department | `660000000000000000000001` |
| team | Sales Team | `660000000000000000000101` |
| team | Design Team | `660000000000000000000102` |
| shop | Football US Shop | `660000000000000000000201` |
| shop | Pet Memorial Shop | `660000000000000000000202` |

Demo users:

| Employee Codes | Count | Role | Scope Type | Scope Name |
|---|---:|---|---|---|
| `J2501`-`J2505` | 5 | `DEPARTMENT_MANAGER` | department | Operations Department |
| `J2506`-`J2509` | 4 | `TEAM_LEADER` | team | Sales Team |
| `J2510`-`J2513` | 4 | `TEAM_LEADER` | team | Design Team |
| `J2514`-`J2522` | 9 | `OPERATOR` | team | Sales Team |
| `J2523`-`J2530` | 8 | `OPERATOR` | team | Design Team |
| `J2531`-`J2535` | 5 | `OPERATOR` | shop | Football US Shop |
| `J2536`-`J2540` | 5 | `OPERATOR` | shop | Pet Memorial Shop |

Email format:

```text
<employeeCode lowercase>@demo.lng.co
```

Example:

```text
j2501@demo.lng.co
```

Organization member views:

```text
GET /api/organization/teams/660000000000000000000101/members
GET /api/organization/teams/660000000000000000000102/members
```

Expected:

- Sales Team has leaders `J2506`-`J2509` and members `J2514`-`J2522`.
- Design Team has leaders `J2510`-`J2513` and members `J2523`-`J2530`.

## 2. Login Bootstrap Admin

Endpoint:

```text
POST /api/auth/login
```

Body:

```json
{
  "email": "admin@example.com",
  "password": "change-me-strong-password"
}
```

Expected:

- `accessToken` exists.
- `GET /api/auth/me` returns `ADMIN`.
- Admin can call `GET /api/auth/accounts`.

## 3. Create Test Accounts

Create three users from admin APIs:

| User | Intended Role | Intended Scope |
|---|---|---|
| `department.manager@example.com` | `DEPARTMENT_MANAGER` | Operations Department |
| `team.leader@example.com` | `TEAM_LEADER` | Sales Team |
| `shop.operator@example.com` | `OPERATOR` | Football US Shop |

Endpoint:

```text
POST /api/auth/accounts
```

Use any valid temporary role when creating the account, then use scoped access assignments below for visual RBAC testing.

## 4. Create Scoped Access Assignments

Department manager:

```json
{
  "accountId": "<departmentManagerAccountId>",
  "roleId": "<departmentManagerRoleId>",
  "scopeType": "department",
  "scopeId": "660000000000000000000001",
  "customPermissionIds": []
}
```

Team leader:

```json
{
  "accountId": "<teamLeaderAccountId>",
  "roleId": "<teamLeaderRoleId>",
  "scopeType": "team",
  "scopeId": "660000000000000000000101",
  "customPermissionIds": []
}
```

Shop operator:

```json
{
  "accountId": "<shopOperatorAccountId>",
  "roleId": "<operatorRoleId>",
  "scopeType": "shop",
  "scopeId": "660000000000000000000201",
  "customPermissionIds": []
}
```

Endpoint:

```text
POST /api/auth/access-assignments
```

Expected:

- Each request returns `201`.
- `GET /api/auth/accounts/:accountId` shows the scoped assignment.
- Login as each test user and call `GET /api/auth/me`; the `scopes` array should show the matching scope.

## 5. Negative Checks

Missing token:

```text
GET /api/auth/accounts
```

Expected: `401`.

Operator without `AUTH:READ`:

```text
GET /api/auth/accounts
Authorization: Bearer <operatorToken>
```

Expected: `403`.

Unregistered scope:

```json
{
  "accountId": "<accountId>",
  "roleId": "<roleId>",
  "scopeType": "team",
  "scopeId": "660000000000000000009999",
  "customPermissionIds": []
}
```

Expected: `400`, because the scope is not registered or is inactive.

Invalid scope shape:

```json
{
  "accountId": "<accountId>",
  "roleId": "<roleId>",
  "scopeType": "team",
  "scopeId": null,
  "customPermissionIds": []
}
```

Expected: `400`, because scoped types require `scopeId`.
