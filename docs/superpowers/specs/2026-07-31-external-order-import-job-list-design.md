# External Order Import Job List API Design

## Goal

Add `GET /external-order-imports` so an operations dashboard can list import jobs without knowing a job ID in advance.

## Contract

The endpoint accepts these optional query parameters:

- `page`: integer greater than or equal to 1.
- `limit`: integer from 1 through 100.
- `status`: one existing external-order import job status.
- `shopId`: a 24-character MongoDB ObjectId.
- `source`: one existing external-order import source.
- `sourceType`: one existing external-order import source type.

Results use the existing `toImportJobDto` shape and standard pagination envelope. Jobs are ordered by `createdAt` descending and `_id` descending, matching the existing repository behavior.

## Authorization

The route requires authentication and either `ORDERS:READ` or `ORDERS:WRITE`.

- System, super-admin, or global order readers may list every matching job.
- Shop-scoped readers may list only jobs belonging to shops where they have `ORDERS:READ` or `ORDERS:WRITE`.
- A scoped caller filtering by a foreign `shopId` receives an empty page, not information about whether that shop has jobs.
- A scoped caller with no readable shops receives an empty page without querying the job list.

Authorization is enforced in the service so every caller receives the same data boundary. The controller only validates input and maps output.

## Components

- Route: register `GET /` before `GET /:jobId` in the existing external-order import router.
- Validator: add a job-list query schema by extending the shared pagination schema with validated job filters.
- Controller: call `listImportJobs(query, auth)` and map results with `toPaginatedDto(result, toImportJobDto)`.
- Service: reuse the existing global-reader and readable-shop logic currently used by issue listing, then call `jobRepository.list` with either the original filters or a constrained `shopIds` filter.
- Repository: reuse the existing `list()` and `buildFilter()` behavior; no new query layer or aggregation pipeline.

## Testing

Use TDD for each production surface:

1. Service tests for global access, scoped shop filtering, explicit foreign shop, and no readable shops.
2. Controller test for query forwarding and DTO pagination output.
3. Route test proving `GET /` is authenticated, permission-protected, and not captured by `/:jobId`.
4. Validator tests through the controller or route for accepted filters and rejected invalid status/ObjectId values.
5. Run external-order import, all Integration, architecture, and full backend regression suites.

## Non-Goals

- No job summary aggregation on the list endpoint.
- No date-range, text-search, or custom sort parameters.
- No database schema or index changes.
- No frontend implementation in this change.
- No new dependency.

## Success Criteria

- Authorized global and scoped callers receive only jobs they may read.
- All filters are validated and forwarded without unknown query fields.
- The response uses existing job DTO and pagination conventions.
- Existing detail, issue, raw-record, retry, and import routes remain unchanged.
- Focused and full regressions pass.
