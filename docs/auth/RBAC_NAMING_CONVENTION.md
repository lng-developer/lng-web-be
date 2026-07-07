# RBAC Naming Convention

This document defines naming rules for RBAC records so roles, permissions, access assignments, and scopes stay consistent across the POD FBM backend.

## Roles

Roles represent reusable responsibility groups. A role must not contain a specific team, department, shop, vendor, or platform instance.

Format:

```text
UPPER_SNAKE_CASE
```

Good examples:

```text
ADMIN
MANAGER
LEADER
USER
FINANCE_MANAGER
SHOP_MANAGER
VENDOR_COORDINATOR
PRODUCTION_STAFF
```

Avoid:

```text
sales_admin
Admin Team A
SHOPIFY_ADMIN
AMAZON_SHOP_1_MANAGER
```

Do not encode scope into the role name. Use `AccessAssignment.scopeType` and `AccessAssignment.scopeId` for that.

Correct:

```text
role = LEADER
scopeType = team
scopeId = salesTeamId
```

Incorrect:

```text
role = SALES_TEAM_LEADER
```

## Permissions

Permissions represent one action on one resource.

Format:

```text
RESOURCE:ACTION
```

Good examples:

```text
AUTH:READ
AUTH:WRITE
ORDERS:READ
ORDERS:WRITE
ORDERS:EXPORT
DESIGN:READ
DESIGN:WRITE
PRODUCTION:READ
PRODUCTION:WRITE
PRODUCTION:ASSIGN
SHIPMENTS:READ
SHIPMENTS:WRITE
FINANCE:READ
FINANCE:WRITE
```

Standard actions:

```text
READ
WRITE
CREATE
UPDATE
DELETE
IMPORT
EXPORT
APPROVE
REJECT
ASSIGN
SUBMIT
CANCEL
REFUND
SYNC
```

For v1, prefer `READ` and `WRITE` unless the action needs to be controlled separately. Add granular actions only when the business workflow requires it.

Descriptions should explain what the permission allows in business terms, for example `Allows exporting order data.`

## Access Assignments

Access assignments do not need a display name. They are authorization records that connect an account, a role, and a scope.

Shape:

```json
{
  "accountId": "...",
  "roleId": "...",
  "scopeType": "team",
  "scopeId": "...",
  "status": "active"
}
```

Scope rules:

```text
global     -> scopeId = null
own        -> scopeId = null
team       -> scopeId is required
department -> scopeId is required
shop       -> scopeId is required
vendor     -> scopeId is required
```

Use access assignments to express business scope:

```text
role = LEADER
scopeType = team
scopeId = salesTeamId
```

Do not create one-off roles for individual scopes:

```text
SALES_TEAM_LEADER
AMAZON_US_USER
MERCHIZE_VENDOR_MANAGER
```

## Scope Registry

Scope registry records make scoped RBAC assignments safe and readable. They register valid resources for `team`, `department`, `shop`, and `vendor`.

Shape:

```json
{
  "scopeType": "team",
  "scopeId": "...",
  "name": "Sales Team",
  "status": "active"
}
```

Name examples:

```text
Sales Team
CS Team
Design Team
Operations Department
Finance Department
Football US Shop
Pet Memorial Shop
Nurse Gift Shop
Family Custom Shirt Shop
Merchize
Printify
Gearment
```

Avoid vague names:

```text
Team 1
Shop test
abc
admin scope
```

## Summary

- Role code: `UPPER_SNAKE_CASE`
- Permission code: `RESOURCE:ACTION`
- Scope type: fixed lowercase enum
- Scope name: human-readable business name
- Access assignment: no name, only account + role + scope
