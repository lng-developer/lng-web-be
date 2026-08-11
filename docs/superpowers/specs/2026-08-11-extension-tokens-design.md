# Extension Tokens Design

## Goal

Allow an administrator to issue, copy once, list, and revoke long-lived credentials for the Amazon Extension without exposing a staff member's login JWT.

## Scope

- A token belongs to exactly one Shop and one environment: `production` or `development`.
- A token grants only `ORDERS:WRITE` at that Shop scope.
- Expiry is optional. A missing expiry means the token stays valid until revoked.
- Multiple active tokens are allowed for the same Shop and environment so each staff machine can be managed separately.
- Only an authenticated administrator with `AUTH:WRITE` can manage tokens.

## Token Lifecycle

1. An admin opens the `Extension Tokens` tab in Access Control, chooses a Shop and environment, enters a label, and optionally supplies an expiry date.
2. The backend generates a cryptographically random token prefixed with `lng_ext_`, stores only its SHA-256 hash, and returns the raw token in the create response exactly once.
3. The UI displays the raw token in a success modal with a copy action. Closing that modal permanently removes the raw token from UI state.
4. The Extension saves the copied token in `chrome.storage.local` and sends it in the Bearer authorization header.
5. Authentication resolves a valid token to a restricted auth context containing only the Shop-scoped `ORDERS:WRITE` permission. The selected environment must match the backend runtime environment.
6. Revoke sets `revokedAt`; all later requests using the token return authentication failure. Expired tokens also return authentication failure.

## Backend Contract

`POST /api/auth/extension-tokens`

```json
{
  "name": "Dev - Hieu PC",
  "shopId": "24-character-object-id",
  "environment": "development",
  "expiresAt": "2026-09-01T00:00:00.000Z"
}
```

`expiresAt` is optional and must be a future ISO timestamp when supplied. The successful response returns token metadata plus `token`; list and revoke responses never include `token` or `tokenHash`.

`GET /api/auth/extension-tokens?shopId=<id>&environment=development`

Returns metadata: id, name, shopId, environment, token hint, created time, last-used time, expiry, and revoked time.

`DELETE /api/auth/extension-tokens/:tokenId`

Revokes an active token. The operation is idempotent from the admin UI perspective: a token that is already revoked is presented as revoked without exposing credential data.

## Data Model

`ExtensionToken` is an Auth-owned collection. It stores `name`, `tokenHash`, `tokenHint`, `shopId`, `environment`, `createdByAccountId`, `lastUsedAt`, `expiresAt`, and `revokedAt`. `tokenHash` is excluded from normal queries. An index supports active-token lookup by hash and operational listing by Shop/environment.

## UI

Access Control gains an `Extension Tokens` tab available only to users with `AUTH:WRITE`. It contains a compact table and a create-token modal. The table exposes no raw credential and provides an icon action to revoke an active token. The create modal shows Shop, environment, label, and optional expiry; the post-create modal uses a read-only credential field with a Copy icon.

## Error Handling

- Invalid/missing/revoked/expired extension tokens return the existing authentication error.
- A valid extension token cannot access routes that require global permissions such as `AUTH:WRITE`.
- An extension token cannot write another Shop because the import service already enforces Shop-scoped `ORDERS:WRITE`.
- Environment mismatch returns authentication error without revealing whether the token exists.

## Tests

- Backend unit tests cover hash-only persistence, one-time raw-token response, optional/future expiry validation, valid token auth context, revoked token rejection, expired token rejection, and environment mismatch.
- Route tests prove `AUTH:WRITE` protects management endpoints and no list/revoke response contains a raw token or hash.
- Frontend tests cover token table rendering, create modal input/validation, raw token copy state, and revoke confirmation.
- Existing Auth suite, architecture checks, frontend tests, lint, and production build must remain green.
