# MangoTee and Printway retry IDs

Implement the approved order/vendor sequence: original ID, -R2, -R3. Keep the marketplace order unchanged. Scope counters by provider, vendor integration owner and original order ID; current integration credentials belong to the vendor. Historical cancelled submissions and the operational MangoTee -R2 override must seed the sequence. Persist the chosen client ID before sending; retain the provider response ID for tracking (especially Printway).

1. Add adapter regression tests for persisted client IDs; add allocation tests for legacy history, recreated submissions and concurrent allocation.
2. Add a small vendorSubmission counter model/repository using Mongo atomic increment. Reconstruct the historical floor in a domain service; queries stay in repositories.
3. Allocate only after the existing READY claim for MangoTee/Printway, persist in payloadSnapshot, and use it in adapters. Dry runs do not consume sequence numbers. Existing NEEDS_REVIEW timeout handling prevents automatic resubmission. Bundle siblings retain the same client ID.
4. Run affected npm tests, architecture checks and syntax checks. Review diff, open PR to develop and await merge authorization. Do not send live vendor orders during verification.

Limits: IDs used outside this system cannot be discovered from local history. Missing numbers after a failed reservation are acceptable; uniqueness is more important than contiguous numbering. Credential rotation retains the vendor's sequence conservatively.
