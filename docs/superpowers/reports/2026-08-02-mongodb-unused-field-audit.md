# MongoDB Unused Field Audit

## Result

The read-only audit covered 12,369 documents and 10,614,070 logical BSON bytes in Atlas database `lng_web_be`. It found no material field that is both unused and safe to remove before deployment.

- Estimated removable bytes: **0**
- `CANDIDATE_UNUSED`: **none**
- Atlas mutations performed: **none**
- Recommendation: **stop; do not build an `$unset` migration for this batch**

Field byte values are comparative estimates. Each aggregation sample wraps a value in a one-key BSON object, so summed field estimates include fixed wrapper overhead and do not exactly partition `collStats.size`.

## Collection Results

| Collection | Documents | Logical bytes | Average bytes | Dominant fields | Classification |
| --- | ---: | ---: | ---: | --- | --- |
| `vendorcostcenters` | 7,591 | 5,963,384 | 785 | `metadata` 819,828 (13.75%); `additionalCosts` 698,372 (11.71%); three shipping objects 440,278 each (7.38%) | `KEEP_CONTRACT` |
| `hrattendancedailies` | 4,609 | 4,109,784 | 891 | `scheduleSnapshot` 2,345,895 (57.08%); `manualAdjustments` 80,934; `leaveSegments` 78,648; `sourceBatchIds` 78,353 | `KEEP_SNAPSHOT`, `KEEP_OPERATIONAL` |
| `externalorderrawrecords` | 94 | 241,167 | 2,565 | `rawRecord` 176,828 (73.32%); `rawRecordHash` 7,614 | `KEEP_OPERATIONAL` |
| `productiontasks` | 72 | 285,084 | 3,959 | `fileChecks` 43,469 (15.25%); seven snapshots total 203,738 (71.46%) | `KEEP_OPERATIONAL`, `KEEP_SNAPSHOT` |
| `vendorsubmissions` | 3 | 14,651 | 4,883 | `payloadSnapshot` 12,619 (86.13%); `statusHistory` 627 | `KEEP_SNAPSHOT`, `KEEP_OPERATIONAL` |

## Evidence And Classification

### `vendorcostcenters`

| Fields | Evidence | Classification |
| --- | --- | --- |
| `metadata` | Accepted by the validator, written by create/update service paths, and returned by the detail DTO (`vendor.validator.js`, `vendor.service.js`, `vendor.dto.js`). Generic metadata access also prevents proving nested keys unused. | `KEEP_CONTRACT` |
| `domesticShipping`, `internationalShipping`, `priorityShipping`, `additionalCosts` | Explicit API input, service update allowlist, model fields, and detail DTO output. These values form the cost-center pricing contract. | `KEEP_CONTRACT` |
| `lngCode` | API input/output and repository search/filter field (`vendorCostCenter.repository.js:39,115-139`). All 7,591 observed values are null, but absence of populated data before deployment is not evidence that the contract is unused. | `KEEP_CONTRACT` |
| Empty dimension/weight defaults | Together only about 43 KiB and below the materiality threshold. Removing defaults would require contract and Mongoose-default analysis for negligible gain. | `KEEP_SMALL` |

### `hrattendancedailies`

| Fields | Evidence | Classification |
| --- | --- | --- |
| `scheduleSnapshot` | Required by the model; department/team paths are indexed; attendance calculation, scoping, time-zone handling, check-in/out, leave reconciliation and DTO output read it throughout `attendance.service.js` and `attendance.dto.js`. It preserves the schedule used for a historical work day. | `KEEP_SNAPSHOT` |
| `leaveSegments` | Indexed by request ID and used to calculate worked schedule, leave units, reconciliation and attendance status. | `KEEP_OPERATIONAL` |
| `manualAdjustments` | Appended atomically by the repository, counted in aggregation, returned by DTO and used as a deletion/reconciliation guard. | `KEEP_OPERATIONAL` |
| `sourceBatchIds` | Used as the import idempotency guard and accumulated during attendance ingestion (`attendance.service.js:354,396`). | `KEEP_OPERATIONAL` |

### `externalorderrawrecords`

| Fields | Evidence | Classification |
| --- | --- | --- |
| `rawRecord` | Written from each imported Excel row and read back to reconstruct rows during retry (`manualExcelImport.service.js:178,672-684`). Removing it would break import recovery. | `KEEP_OPERATIONAL` |
| `rawRecordHash` | Indexed and used as the persisted record identity/deduplication value. | `KEEP_OPERATIONAL` |
| Status, lease, error and order/item link fields | Repository claim/update operations and post-import retry lifecycle depend on them; DTOs expose the operational result. | `KEEP_OPERATIONAL` |

### `productiontasks`

| Fields | Evidence | Classification |
| --- | --- | --- |
| `orderSnapshot`, `orderItemSnapshot`, `listingSnapshot`, `templateSnapshot`, `vendorProductSnapshot`, `vendorCostCenterSnapshot`, `customizationSnapshot` | Built when task readiness is evaluated (`productionTask.service.js:760-784`). Repository filters, searches, summaries and exports read snapshot paths; missing order/customization snapshots are enriched only as backward-compatible fallback. They preserve the task's historical production context. | `KEEP_SNAPSHOT` |
| `fileChecks` | Drives readiness aggregation, design output mutation, CAS filters, QC, scoring, export and vendor payload construction. Repository updates individual array elements atomically. | `KEEP_OPERATIONAL` |

### `vendorsubmissions`

| Fields | Evidence | Classification |
| --- | --- | --- |
| `payloadSnapshot` | Created from the production task, exposed through preview/detail DTOs, queried by vendor/order filters, and consumed by all vendor adapters to construct the external submission. | `KEEP_SNAPSHOT` |
| `statusHistory` | Appended on create, submit, fail, retry, review and reconciliation transitions and exposed by the detail DTO. It is lifecycle evidence and also contributes to audit mutation identity. | `KEEP_OPERATIONAL` |

## Small Version Keys

Mongoose `__v` contributes an estimated 197,904 bytes across the five collections (about 1.86% of their combined logical bytes):

- `vendorcostcenters`: 121,456 bytes
- `hrattendancedailies`: 73,744 bytes
- `externalorderrawrecords`: 1,504 bytes
- `productiontasks`: 1,152 bytes
- `vendorsubmissions`: 48 bytes

This is not a justified pre-deployment migration. Disabling version keys changes Mongoose update semantics, especially for array-bearing documents, while the maximum logical saving is under 200 KiB. Classification: `KEEP_SMALL`.

## Decision

No field satisfies the removal gate: material stored bytes, no live references, no index or contract role, and no recovery/history requirement. The measured bloat is predominantly intentional snapshots and operational state, not dead schema.

Do not create an allowlist, backup job, or `$unset` command for this batch. Revisit storage only after production growth data exists; the next useful lever is retention/archival policy for raw imports and completed submission/task snapshots, which is deliberately outside this unused-field audit.
