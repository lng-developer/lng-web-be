# Safe Vendor Submission Workflow

## Goal

Automatically hand a production task to its mapped vendor after QC passes without using the wrong credential, fabricating customer data, or creating duplicate vendor orders. Add an operations workbench only after the backend safety gates pass.

## Backend contract

- `ProductionTask` reaching `READY_TO_SEND_VENDOR` creates one active vendor submission.
- The provider is derived from `payloadSnapshot.vendorProduct.vendor.providerKey`; callers cannot override it.
- Credentials are resolved by both `vendorId` and `providerKey`.
- A real submit atomically claims `READY` as `SUBMITTING` before network I/O.
- Every submission has a stable provider order key derived from the submission ID. Adapters send that key through the provider's native order-number field.
- `SUBMITTING` is not blindly retried after a transport timeout. It becomes `NEEDS_REVIEW` unless provider lookup proves whether the order exists.
- Provider rejection becomes `FAILED`; a confirmed absence may be returned to `READY`; a confirmed remote order becomes `SUBMITTED`.
- A `SUBMITTED` submission always retries the idempotent Production handoff until the task reaches `SENT_TO_VENDOR`.
- Date-only `dateTo` values are normalized to the end of the UTC day.

## Payload validation

- Remove placeholder names, emails, phone numbers, and countries.
- Adapter validation rejects missing provider-required recipient, address, SKU, quantity, and artwork fields before any external request.
- Provider responses and audit metadata continue to strip secrets and customer payloads.

## Automatic flow

1. QC passes and Production becomes `READY_TO_SEND_VENDOR`.
2. Production creates the idempotent `READY` submission.
3. The automatic dispatcher validates mapping, provider, credential, and payload.
4. It atomically claims the submission and calls the provider once.
5. A confirmed response records `SUBMITTED` and repairs the Production handoff.
6. A provider rejection records `FAILED` and notifies the owner.
7. An ambiguous transport result records `NEEDS_REVIEW`; no automatic POST retry occurs.

The initial dispatcher remains inline with the existing QC trigger. A queue is deferred until throughput or retry scheduling requires it.

## Frontend workbench

Add `/portal/vendor-submissions`, guarded by backend-provided `VENDOR_SUBMISSIONS:READ` or `WRITE` permissions and shop scopes.

- Summary counts and server-side filters for status, shop, vendor, external order, and date.
- Paginated submission table and detail drawer with sanitized payload preview and status history.
- Dry-run validation for `READY` items.
- Explicit confirmation for real submit.
- Retry only for `FAILED`; reconciliation controls for `NEEDS_REVIEW`; cancel only where the backend permits it.
- Loading, empty, error, stale-state conflict, and mutation feedback states.

Provider is displayed from the submission and is never editable in the workbench.

## Verification gates

- Repository tests cover atomic claim, stale claim recovery, conditional transitions, and date-only upper bounds.
- Service tests cover vendor-scoped credentials, fixed provider selection, no placeholder data, concurrent submit, ambiguous timeout, provider rejection, and Production handoff recovery.
- Route tests cover validation and RBAC for every new mutation.
- Existing Vendor Submission and architecture suites remain green before FE work starts.
- FE contract, RBAC, filtering, detail, dry-run, submit, retry, reconciliation, and error-state tests pass with lint and production build.

## Deferred

- Distributed job queue and scheduled polling.
- Provider-specific lookup where no documented lookup API currently exists.
- Automatic retry of ambiguous network outcomes.
