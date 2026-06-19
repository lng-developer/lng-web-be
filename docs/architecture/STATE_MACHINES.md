# State Machines

This document defines baseline state contracts for import and customization workflows. Keep state transitions explicit and service-owned.

## External Order Import Job

```text
PENDING
  -> PARSING
  -> IMPORTING
  -> COMPLETED
```

Failure and stop states:

```text
PARSING -> FAILED
IMPORTING -> PARTIAL_FAILED
IMPORTING -> FAILED
PENDING/PARSING/IMPORTING -> CANCELLED
PARTIAL_FAILED -> IMPORTING
FAILED -> PENDING
```

Expected statuses:

- `PENDING`: job created, not started
- `PARSING`: source file/report is being parsed
- `IMPORTING`: normalized records are being handed to `order`
- `COMPLETED`: all importable records completed
- `PARTIAL_FAILED`: some records failed and issues remain open
- `FAILED`: job-level failure prevented completion
- `CANCELLED`: operator/system stopped the job

## External Order Raw Record

Normalize status:

```text
PENDING -> NORMALIZED
PENDING -> FAILED
PENDING -> SKIPPED
FAILED -> PENDING
```

Import status:

```text
PENDING -> IMPORTED
PENDING -> FAILED
PENDING -> SKIPPED
FAILED -> PENDING
```

Rules:

- Normalize status tracks source-to-DTO conversion.
- Import status tracks DTO-to-order public port result.
- Skipped rows should include a reason through an issue or error field.

## External Order Import Issue

```text
OPEN -> RESOLVED
OPEN -> IGNORED
IGNORED -> OPEN
RESOLVED -> OPEN
```

Issue types:

- `NORMALIZE_FAILED`
- `SHOP_RESOLVE_FAILED`
- `ORDER_IMPORT_FAILED`
- `DUPLICATE_RECORD`
- `MISSING_REQUIRED_FIELD`
- `CUSTOMIZATION_PARSE_PENDING`

Severity:

- `INFO`
- `WARNING`
- `ERROR`
- `CRITICAL`

## Customization Payload

```text
PENDING
  -> DOWNLOADING
  -> DOWNLOADED
  -> EXTRACTING
  -> PARSED
```

Review and failure states:

```text
PENDING/DOWNLOADING/DOWNLOADED/EXTRACTING -> FAILED
PENDING/DOWNLOADING/DOWNLOADED/EXTRACTING -> NEEDS_REVIEW
FAILED -> PENDING
NEEDS_REVIEW -> PENDING
NEEDS_REVIEW -> PARSED
```

Rules:

- `PENDING`: payload stored, parse not started
- `DOWNLOADING`: external assets are being downloaded
- `DOWNLOADED`: assets are available
- `EXTRACTING`: parser is deriving structured customization data
- `PARSED`: customization is ready for downstream modules
- `NEEDS_REVIEW`: automated parse is insufficient
- `FAILED`: retryable or terminal error recorded with `errorCode` and `errorMessage`

## Service Ownership

State transitions belong in services. Controllers request actions; repositories persist transitions; models validate allowed values and indexes.
