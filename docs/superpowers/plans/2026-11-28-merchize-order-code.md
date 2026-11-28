# Merchize order code and tracking identity

Scope: additive BE DTO/model fields and FE display; keep existing technical vendorExternalOrderId unchanged. No production writes or migration.

Evidence: Merchize create receipt data._id differs from list-orders-detail data._id. Detail exposes code RY-65286-27564 and external_number matching the submitted reference.

Implementation:
- Capture vendorOrderCode from an exact matching tracking/detail response; keep vendorOrderReference as the submitted reference including retry suffix.
- Query by submitted external_number + identifier; only use actual known vendor codes as code, never a 24-hex receipt ID.
- Reject unrelated/ambiguous rows; do not use startsWith for retries.
- Save resolved code for submission and shipment through module public ports and repositories, guarded by original identity. Preserve poll transaction/lease boundary and pending metadata.
- UI uses code or an explicitly labeled submitted reference; technical receipt ID remains in details. Non-Merchize unchanged.
- Cover polling with/without tracking, retries, wrong/ambiguous rows, metadata persistence, legacy DTO and FE display.
