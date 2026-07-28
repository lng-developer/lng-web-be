# RBAC Relationship Demo Seed

This seed creates an inspectable demo graph across Auth, Organization/RBAC, and Shop.

Run:

```bash
npm run seed:demo:relationships
```

The script is idempotent. It upserts fixed demo data and can be run again after local cleanup.

Default demo password:

```text
Demo@123456
```

## What It Seeds

- RBAC base roles and permissions.
- Demo accounts; employee profiles are owned by HR seeds/migration.
- One operations department with sales and design teams.
- Team memberships for leaders and staff.
- Demo shops.
- Scope registry entries for department, teams, and shops.
- Scoped role permission overrides for department, team, and shop scopes.
- One global admin account:
  - `admin.relationship@demo.lng.co`
  - employee code `ADM-DEMO`

## Collections To Inspect

Inspect these collections in this order to see the relationships:

1. `accounts`
2. `hremployeeprofiles`
3. `roles`
4. `permissions`
5. `accessassignments`
6. `departments`
7. `teams`
8. `teammemberships`
9. `shops`
10. `scoperegistries`
11. `scopedrolepermissions`

Useful demo accounts:

| Purpose | Employee code | Scope |
| --- | --- | --- |
| Global admin | `ADM-DEMO` | global |
| Department manager | `J2501` | Operations Department |
| Sales leader | `J2506` | Sales Team |
| Sales staff | `J2514` | Sales Team |
| Football shop staff | `J2531` | Football US Shop |

## Relationship Map

```text
accounts._id
  -> hremployeeprofiles.accountId (optional)
  -> accessassignments.accountId
  -> accessassignments.roleId -> roles._id
  -> roles.permissions[] -> permissions._id

accessassignments.scopeType + accessassignments.scopeId
  -> scoperegistries.scopeType + scoperegistries.scopeId

departments._id
  -> teams.departmentId
  -> teammemberships.teamId
  -> teammemberships.accountId -> accounts._id

scopedrolepermissions.scopeType + scopedrolepermissions.scopeId + scopedrolepermissions.roleId
  -> scope-specific role permission override

shops._id
  -> scoperegistries.scopeId where scopeType = "shop"
  -> accessassignments.scopeId where scopeType = "shop"
```

## Notes

- The seed does not restore the removed legacy `/department-role-permissions` API.
- The canonical override collection is `scopedrolepermissions`.
- `ScopedRolePermission` rules demonstrate exact-scope overrides. If no exact scoped rule exists, effective permissions fall back to `roles.permissions`.
