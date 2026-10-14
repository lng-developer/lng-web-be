# Design and Production RBAC

## Purpose

Separate responsibility for reusable PSD templates from order-specific artwork
scaling, while preserving the existing `DesignTask` and `ProductionTask`
pipeline. A staff member must see and mutate only work appropriate to their
role and assignment.

## Confirmed domain boundary

- `DesignTask` owns a PSD template for a listing variant. Its approved PSD is
  reusable across orders.
- `ProductionTask` owns the file checks, scaled outputs, QC and vendor
  readiness for one order item.
- A PSD approval updates Catalog then rechecks production tasks blocked by
  `PSD_MISSING`.
- Scaling remains a `ProductionTask.fileChecks[]` operation. No `ScaleRequest`
  aggregate is introduced.

## Roles

| Role | Scope | Allowed work |
| --- | --- | --- |
| `CS_OPERATOR` | Own sales orders | Create and update customer/order requests; read production state for relevant orders. |
| `SALES_LEADER` | Sales team orders | View team orders and requests; submit design requests. |
| `DESIGNER` | Assigned PSD tasks | Read assigned PSD work, upload and submit PSD assets. |
| `DESIGN_LEADER` | Design team | Assign, review and approve PSD tasks; view PSD-blocked production context. |
| `SCALE_OPERATOR` | Assigned production tasks | Download source assets, upload scaled output and submit it for QC. |
| `SCALE_LEADER` | Scale queue | View queue and assign/reassign scale work; manage workload. |
| `QC_REVIEWER` | QC queue | Pass or reject scaled outputs. |
| `PRODUCTION_OPERATOR` | Operational exception scope | Existing broad production administration only. |

`SUPER_ADMIN` remains the explicit cross-cutting break-glass role.

## Permission contract

Keep existing design permissions for PSD work:

```text
DESIGN:READ
DESIGN:WRITE
DESIGN:WORK
DESIGN:REVIEW
```

Add least-privilege production permissions for the per-order scale stage:

```text
PRODUCTION:READ
PRODUCTION:SCALE_WORK
PRODUCTION:SCALE_ASSIGN
PRODUCTION:QC_REVIEW
PRODUCTION:WRITE
```

`PRODUCTION:WRITE` remains an operational/admin permission and must not be
granted to ordinary CS scale staff.

## Authorization rules

1. A PSD designer may mutate only a `DesignTask` assigned to them.
2. A design leader may assign and approve PSD tasks belonging to their Design
   team.
3. A scale operator may mutate only a `ProductionTask` whose
   `csAssigneeId` equals their account ID. The legacy
   `assignedDesignUserId` must not authorize scale work.
4. A scale leader may assign or reassign `csAssigneeId` for the managed scale
   queue, but cannot pass QC solely because they can assign.
5. A QC reviewer can pass/reject only a task with required scale output. They
   cannot upload or replace that output under the QC permission alone.
6. Read visibility follows the existing ownership/team policy for Sales and
   the assignee/team policy for Design and Production. Static permissions alone
   must not grant a normal worker the entire queue.

## Data and compatibility

`ProductionTask.csAssigneeId`, `csAssignedBy`, `csAssignedAt` and `csStatus`
are the canonical scale-assignment fields. Existing `assignedDesignUserId`
continues to represent the production design assignee until a separate,
approved data migration says otherwise.

Existing roles keep their current permissions during rollout. The migration
must grant the new scale roles only to accounts explicitly in the Scale/CS
team; it must not elevate all `CS_OPERATOR` accounts.

## Flow

```text
Sales request
  -> Design leader assigns PSD task
  -> PSD designer submits
  -> Design leader approves PSD
  -> Catalog stores PSD and rechecks PSD-blocked production task
  -> Scale leader assigns csAssigneeId
  -> Scale operator uploads output
  -> QC reviewer passes or rejects
  -> READY_TO_SEND_VENDOR
```

## Error handling and audit

- Return `403 AUTHORIZATION_ERROR` for an out-of-scope mutation without
  revealing other worker/task data.
- Preserve existing optimistic-concurrency checks on production mutations.
- Audit role assignment, scale assignment, output upload, QC decision and
  vendor-ready transition with actor, task ID and previous/new state.
- Reject QC pass when a required scaled output is absent.

## Verification

Add targeted authorization tests for:

1. A PSD designer cannot change another designer's task.
2. A scale operator can upload only for their `csAssigneeId` task.
3. A scale operator cannot assign work, approve PSD, pass QC or send vendor.
4. A scale leader can assign/reassign but cannot perform QC without
   `PRODUCTION:QC_REVIEW`.
5. A QC reviewer can reject/pass eligible output but cannot overwrite it.
6. Sales users retain order ownership/team isolation and cannot access the
   Design or Scale queues by permission escalation.

Run architecture, auth and production-focused tests before release, followed
by an API E2E sequence covering PSD approval through QC pass.

## Out of scope

- A separate `ScaleRequest` model or module.
- Shop-specific policy changes.
- Automatic scaling, vendor behavior changes or frontend redesign.
