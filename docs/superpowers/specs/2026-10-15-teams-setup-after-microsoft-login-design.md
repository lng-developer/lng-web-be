# Teams setup after Microsoft login

## Goal

Make Teams chat synchronization require one explicit Microsoft consent per Portal account while keeping Portal chat independent, immediate, and available to accounts without Teams.

## Decisions

- Portal chat is never blocked by Teams setup, token refresh, Graph failures, or outbox retries.
- Microsoft SSO and Portal-password login are authentication methods for one canonical Portal `Account`; they must never create or link a second account by display name or unverified email.
- Microsoft SSO identifies the existing canonical account by normalized, verified work email and the stored Entra subject. Portal-password login remains valid without proving or changing Microsoft identity.
- Any authenticated account that already has a Microsoft identity but lacks a usable Teams refresh grant is offered Teams setup. The offer is non-blocking for both login methods.
- The prompt is contextual and durable: it appears again only when the server reports `NOT_CONNECTED` or `REAUTH_REQUIRED`.
- The server owns Graph refresh tokens. They remain encrypted at rest and never return to the browser.
- Existing valid grants are preserved. There is no bulk logout or grant revocation as part of this rollout.
- Accounts without a Microsoft identity can use Portal chat normally and are not prompted.

## State contract

The authenticated user-facing endpoint returns only the caller's state:

```json
{
  "enabled": true,
  "userLinked": true,
  "grantStatus": "CONNECTED | NOT_CONNECTED | REAUTH_REQUIRED"
}
```

`CONNECTED` requires an encrypted refresh token. A linked mapping without one is `REAUTH_REQUIRED`.

## Login and setup flow

1. The user signs in through either Microsoft SSO or Portal password. Both return the same canonical account, Portal access token, and refresh session.
2. Existing account-setup/password requirements run before chat access; Teams setup never bypasses them.
3. The frontend reads the user-scoped Teams OAuth status once authenticated.
4. If Teams is enabled and the current account has a Microsoft identity but no usable grant, the frontend shows a non-blocking setup prompt. Password-login users are never redirected or popuped automatically.
5. The user chooses **Connect Teams**. The existing server-generated OAuth authorization URL opens in a popup.
6. The callback validates state and PKCE, and accepts consent only when the Microsoft account matches the canonical Portal account by normalized verified email and Entra subject. It encrypts and stores the refresh token, then closes the popup.
7. The frontend refreshes status when focus returns. `CONNECTED` removes the prompt.
8. Later Graph refresh or send failures that make the grant unusable mark the account `REAUTH_REQUIRED`; the setup prompt returns on a future authenticated page load.

## Delivery and failure handling

- Portal message acknowledgement and Socket.IO delivery complete before Teams processing.
- The Mongo outbox owns Portal-to-Teams retries and idempotency.
- A failed Teams send stays in `RETRY` or `FAILED` with sanitized error metadata; it does not resend or duplicate the Portal message.
- Teams-to-Portal uses the existing webhook/polling integration and writes idempotent inbound mappings.
- The user-facing prompt never exposes Graph errors, access tokens, tenant IDs, or diagnostics.

## UI placement

Use one reusable Teams setup prompt mounted in the authenticated Portal shell, not in an individual chat header. It must:

- appear for eligible users on any Portal route;
- show after either login method only when the canonical account has a Microsoft identity and needs consent;
- never auto-open Microsoft login or consent for a password-login session;
- have a clear primary action to connect;
- allow dismissal for the current session without disabling Portal chat;
- show a concise reconnect message for `REAUTH_REQUIRED`;
- refresh its state after the OAuth popup returns.

The existing chat header may retain a passive `Teams Connected` status, but it must not be the sole place a user discovers setup.

## Rollout

1. Deploy the shell prompt and status contract.
2. Verify with `hieunv` and `luannd`: Portal-to-Portal realtime, Portal-to-Teams outbox `SENT`, and Teams-to-Portal `INBOUND/SYNCED`.
3. Preserve existing valid refresh grants.
4. Let accounts with mappings but no refresh token, such as the current `luannd` mapping, reauthorize through the prompt.
5. Only consider a targeted Teams-grant revocation after the flow is proven; do not revoke Portal sessions as part of this feature.

## Verification

- Backend controller/service tests cover caller-scoped status and OAuth callback identity matching.
- Frontend tests cover prompt visibility, popup start, status refresh after focus, dismissal, and no prompt for `CONNECTED` or non-Microsoft users.
- End-to-end smoke tests verify no Portal chat delay when Teams is unavailable and confirm outbox/mapping state without inspecting message bodies.
