# Organization API Guide

The `organization` module owns real department/team business data. Auth keeps RBAC data only through `ScopeRegistry`, `Role`, `Permission`, and `AccessAssignment`.

When a department or team is created or updated, organization syncs the matching auth scope through `auth/public.js`.

## Demo Seed

Run the full demo seed:

```bash
npm run seed:demo:full
```

This creates:

- RBAC roles and permissions.
- Bootstrap admin.
- 40 demo auth users from `J2501` to `J2540`.
- Organization data for one department and two teams.
- One active team membership per seeded employee.

Demo organization data:

| Type | Name | ID |
|---|---|---|
| department | Operations Department | `660000000000000000000001` |
| team | Sales Team | `660000000000000000000101` |
| team | Design Team | `660000000000000000000102` |

Demo team membership:

| Team | Leaders | Members |
|---|---|---|
| Sales Team | `J2506`-`J2509` | `J2514`-`J2522` |
| Design Team | `J2510`-`J2513` | `J2523`-`J2530` |

Demo user password:

```text
Demo@123456
```

## Auth

All endpoints require:

```text
Authorization: Bearer <accessToken>
```

Read endpoints require `AUTH:READ`.
Write endpoints require `AUTH:WRITE`.

## Departments

### GET `/api/organization/departments`

Query:

- `status`: `active` or `inactive`
- `search`
- `page`
- `limit`

### POST `/api/organization/departments`

Body:

```json
{
  "name": "Operations Department",
  "code": "OPERATIONS"
}
```

Creates a department and syncs auth scope:

```json
{
  "scopeType": "department",
  "scopeId": "<departmentId>",
  "name": "Operations Department"
}
```

### GET `/api/organization/departments/:departmentId`

Returns one department.

### PATCH `/api/organization/departments/:departmentId`

Body:

```json
{
  "name": "Operations Department",
  "code": "OPERATIONS",
  "status": "active"
}
```

## Teams

### GET `/api/organization/teams`

Query:

- `departmentId`
- `status`: `active` or `inactive`
- `search`
- `page`
- `limit`

### POST `/api/organization/teams`

Body:

```json
{
  "name": "Sales Team",
  "code": "SALES",
  "departmentId": "660000000000000000000001"
}
```

Creates a team and syncs auth scope:

```json
{
  "scopeType": "team",
  "scopeId": "<teamId>",
  "name": "Sales Team"
}
```

### GET `/api/organization/teams/:teamId`

Returns one team.

### PATCH `/api/organization/teams/:teamId`

Body:

```json
{
  "name": "Sales Team",
  "code": "SALES",
  "departmentId": "660000000000000000000001",
  "status": "active"
}
```

### GET `/api/organization/teams/:teamId/members`

Returns leaders and members for one team.

Example:

```json
{
  "success": true,
  "data": {
    "team": {
      "id": "660000000000000000000101",
      "name": "Sales Team",
      "code": "SALES"
    },
    "leaders": [
      {
        "employeeCode": "J2506",
        "fullName": "J2506 Sales Team Leader",
        "memberType": "leader",
        "roles": ["TEAM_LEADER"]
      }
    ],
    "members": [
      {
        "employeeCode": "J2514",
        "fullName": "J2514 Sales Operator",
        "memberType": "member",
        "roles": ["OPERATOR"]
      }
    ]
  }
}
```

### GET `/api/organization/member-candidates`

Returns active auth profiles that do not have an active organization team membership.

Query:

- `search`: employee code, name, or email
- `limit`: `1`-`100`

The frontend Add Member modal should use this endpoint instead of free-text employee input.

### POST `/api/organization/teams/:teamId/members`

Body:

```json
{
  "accountId": "660000000000000000000201",
  "memberType": "leader"
}
```

`memberType` can be `leader` or `member`.
Instead of `accountId`, operators may send `employeeCode`; the service resolves it to the auth account:

```json
{
  "employeeCode": "J2533",
  "memberType": "leader"
}
```

Send exactly one of `accountId` or `employeeCode`.

Each account can have only one active organization team membership. If the account already belongs to another active team, this endpoint automatically deactivates the old membership and moves the account to the target team.

Response includes `moved: true` when the account was moved from a previous team.

### DELETE `/api/organization/teams/:teamId/members/:accountId`

Soft-removes an active team membership.
