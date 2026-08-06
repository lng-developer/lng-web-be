# Full API and Postman Contract Design

## Goal

Give frontend developers a complete, executable description of every public backend endpoint: method, URL, authorization, parameters, request payload, response payload, errors, and realistic Postman examples.

## Source of Truth

Documentation must be derived from runtime code in this order:

1. Module route for method, path, authentication, and permissions.
2. Validator for path, query, JSON, and multipart inputs.
3. Controller for HTTP status and response envelope.
4. DTO for response fields.
5. Service/constants for operational errors and lifecycle restrictions.
6. Route/service tests for verified examples and edge cases.

Existing Markdown or Postman files are evidence only. When they conflict with runtime code, runtime code wins and the stale artifact is corrected.

## Deliverables

Each public module receives:

- One Markdown API reference grouped by resource and workflow.
- One importable Postman collection with runnable requests.
- Request examples using shared environment and collection variables.
- Postman tests for success status, response envelope, and safe identifier capture.

The repository also receives:

- A shared local environment template with no credentials.
- A shared development environment template with no credentials.
- A Postman README covering import, authentication, variables, uploads, and collection execution.
- One aggregate `LNG Web BE` collection or workspace index that exposes every module collection.
- A route coverage audit proving every authenticated/public Express route is documented or explicitly excluded.

Modules in scope are Auth, Organization, HR, Shop, Catalog, Order, Customization, Mapping, Media, Design, Production, Vendor, VendorSubmission, Shipment, Finance, Report, Integration, Audit, Notification, and WorkScore.

## Endpoint Contract Standard

Every endpoint entry must contain:

- Method and full path under `/api`.
- Purpose and lifecycle effect.
- Required permission or anonymous access.
- Path parameters with type and validation.
- Query parameters with type, default, allowed values, and pagination behavior.
- JSON body or multipart fields with required/optional status.
- Success status and exact DTO-based response example.
- Expected operational errors with status, stable code when available, and trigger.
- Notes for idempotency, concurrency, terminal states, downloads, or binary responses.

Examples must use valid placeholder ObjectIds and realistic enum values. They must not include secrets, real tokens, customer PII, filesystem paths, or provider credentials.

## Postman Standard

Shared variables include `baseUrl`, `accessToken`, shop/account/resource identifiers, and workflow identifiers such as `orderItemId`, `listingVariantId`, `productionTaskId`, and `vendorSubmissionId`.

Collections use Bearer inheritance where applicable. Login captures `accessToken`. Create/list requests capture identifiers only when the response contains them. Destructive or production-facing requests are marked clearly and are not included in a default safe collection run.

Multipart requests define real `form-data` keys. File paths remain unset so each developer selects a local fixture. Download/export requests document binary handling instead of parsing JSON.

## Rollout

1. Foundation: inventory all mounted routes; add shared environment, README, conventions, and coverage checker.
2. Access: Auth, Shop, Organization, HR.
3. Setup: Catalog, Mapping, Vendor, Media.
4. Operations: Order, Customization, Integration.
5. Fulfillment: Design, Production, VendorSubmission, Shipment.
6. Business support: Finance, Report, Audit, Notification, WorkScore.
7. Aggregate verification: route coverage, JSON validation, collection lint, safe smoke run, and final FE handoff index.

Each batch updates both Markdown and Postman artifacts. A batch is incomplete if one format is missing.

## Verification

- Parse every Postman collection/environment as JSON.
- Validate every documented method/path against the Express route inventory.
- Check duplicate collection request names and missing variables.
- Run existing narrow module tests while auditing behavior.
- Run a safe Postman smoke subset against local BE when authentication and local runtime are available.
- Run architecture tests and the full backend suite once at final completion.

## Out of Scope

- OpenAPI generation or Swagger UI.
- Generated TypeScript clients.
- Changing API behavior merely to simplify documentation.
- Adding endpoints that do not exist.
- Saving live tokens, passwords, credentials, customer data, or vendor secrets.
- Automatically executing destructive, vendor-submit, payroll-write, or bulk mutation requests.
