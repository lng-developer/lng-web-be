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
- Demo shop records and matching Auth shop scopes.

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

Read endpoints accept global or matching scoped `AUTH:*` / `TEAMS:*` access and are filtered again by the service.
Department/team master writes require global `AUTH:WRITE`. Membership writes accept `AUTH:WRITE` or `TEAMS:WRITE`, then enforce the exact department/team scope.

## Departments

### GET `/api/organization/health`

Public health check. Returns:

```json
{
  "module": "organization",
  "status": "ok"
}
```

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

### GET `/api/organization/member-candidates`

Requires any of `AUTH:WRITE` or `TEAMS:WRITE`.

Query:

- `search`: optional trimmed text, maximum 120 characters.
- `limit`: optional integer from 1 to 100.

Returns active account/employee candidates that may be assigned to a team. Use the returned account `id` as `accountId` in the team-member request.

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
        "accountId": "660000000000000000000206",
        "employeeCode": null,
        "fullName": null,
        "email": "j2506@demo.lng.co",
        "memberType": "leader",
        "roles": []
      }
    ],
    "members": [
      {
        "accountId": "660000000000000000000214",
        "employeeCode": null,
        "fullName": null,
        "email": "j2514@demo.lng.co",
        "memberType": "member",
        "roles": []
      }
    ]
  }
}
```

Member DTOs are currently account-based. HR profile fields are `null`, and `roles` contains only global Auth roles; the `memberType` field is the authoritative team classification.

### POST `/api/organization/teams/:teamId/members`

Body:

```json
{
  "accountId": "660000000000000000000201",
  "memberType": "leader"
}
```

`memberType` can be `leader` or `member`.
`accountId` is required. Employee-code lookup is not part of the current Organization API.

Each account can have only one active organization team membership. If the account already belongs to another active team, this endpoint automatically deactivates the old membership and moves the account to the target team.

Response includes `moved: true` when the account was moved from a previous team.

A department-scoped `TEAMS:WRITE` actor may manage leaders and members in that department. A team-scoped `TEAMS:WRITE` actor may manage only `member` records inside that exact team.

### DELETE `/api/organization/teams/:teamId/members/:accountId`

Soft-removes an active team membership.
