# Extension command Phase 1 plan

1. Add the compact integration command model, repository, validation, routes,
   DTOs, and service with shop-scoped authorization and atomic leases.
2. Extend the existing Integrations extension tab with agent selection, command
   creation, and status list.
3. Add a small extension polling client that invokes the existing order import
   function and reports completion.
4. Run focused backend, frontend, and extension checks.
