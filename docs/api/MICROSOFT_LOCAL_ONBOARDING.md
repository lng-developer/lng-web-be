# Microsoft onboarding and LNG passwords

Microsoft sign-in and local sign-in use the same account and scoped permissions.
Microsoft supplies the account/work email; personal email is contact information,
not a second login identity. Microsoft passwords are never requested by LNG.

1. Sign in through Microsoft. Passwordless Microsoft accounts receive
   `passwordSetupRequired: true` from login and `GET /api/auth/me`.
2. Complete the existing personal-profile form. Work email is read-only.
3. Create an independent LNG password (12–128 characters).
4. Renew the session through local login. Subsequent logins accept work email or
   employee code with that LNG password; Microsoft sign-in remains available.

## Initial password endpoint

`POST /api/auth/me/initial-password`, authenticated and login-rate-limited.

Body: `{ "newPassword": "<user-chosen LNG password>" }`.

Only the authenticated active Microsoft-linked account can initialize its own
password, after profile completion, and only if no local credentials exist.
The response uses the existing account DTO envelope. It does not expose hashes.
Incomplete profile returns `ACCOUNT_SETUP_REQUIRED` (403); an ineligible account
returns 403; a competing password update returns 409. Existing credentials must
use the existing change-password flow instead.

The update invalidates prior sessions and increments token version. HTTP business
routes and chat socket connections reject accounts still requiring password setup.
No migration or role changes are required. Existing Microsoft-only users also
complete this step on their next authenticated visit.

## Manual acceptance checks

- New Microsoft user: profile, password, workspace, logout, email/password login,
  logout, employee-code/password login; all show the same account and permissions.
- Existing local admin: original password login and setup behavior unchanged.
- Existing Microsoft user with a local password: no initial-password prompt.
- Wrong password, incomplete profile, repeated initial-password submission and
  attempting business API/socket access before setup are rejected.

Local LNG login does not itself create a Microsoft delegated Graph session.
