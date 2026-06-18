# ADR 0002: Cross-Module Calls Use Public Ports

## Status

Accepted

## Context

The backend is a strict modular monolith. Modules need to collaborate without leaking persistence details or coupling services to another module's internals.

## Decision

Cross-module communication must go through the target module's `public.js`.

Allowed:

```js
const authPort = require('../../auth/public');
```

Forbidden:

```js
const AccessAssignment = require('../../auth/models/accessAssignment.model');
```

## Consequences

- Public ports define stable module capabilities.
- Services may orchestrate other modules only through public ports.
- Repositories and models remain private to their module.
- Architecture tests should reject cross-module internal imports.
