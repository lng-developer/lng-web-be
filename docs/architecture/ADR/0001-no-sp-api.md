# ADR 0001: Do Not Use Amazon SP-API

## Status

Accepted

## Context

The platform imports Amazon orders through operator-controlled sources. The current product direction does not require Amazon SP-API integration.

## Decision

The system must not implement Amazon SP-API clients, credentials, cursors, polling, report APIs, or SP-API terminology.

Allowed order import sources are:

- `AMAZON_EXTENSION_REPORT`
- `MANUAL_EXCEL`

## Consequences

- Import work is implemented as source file/report handling, not Amazon API synchronization.
- Environment variables must not include SP-API secrets.
- Docs, constants, DTOs, and source names should avoid SP-API language.
- Future Amazon API integration would require a new ADR before implementation.
