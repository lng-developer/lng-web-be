# Microsoft Teams Setup Guide - Phase 1

This guide provides setup instructions for the Microsoft Teams 1-to-1 chat integration with LNG Portal.

---

## 1. Entra ID App Registration

1. Navigate to **Microsoft Entra admin center** (or Azure Portal) → **App registrations**.
2. Select your application or register a new one.
3. Configure Redirect URIs:
   - **Single-page application (SPA)**: `https://<PORTAL_DOMAIN>/`
4. Under **Certificates & secrets**, generate a new **Client secret**. Save the secret value for backend configuration.

---

## 2. API Permissions & Admin Consent

Configure the following Microsoft Graph permissions under **API permissions**:

### Delegated Permissions (Least Privileged)
- `ChatMessage.Send` - Send 1-to-1 direct chat messages as the signed-in employee
- `Chat.ReadWrite` - Read and write user 1-to-1 chats
- `User.Read` - Read signed-in user's profile
- `offline_access` - Maintain access to data / acquire refresh tokens for server dispatch
- `openid`, `profile`, `email`

### Application Permissions (Least Privileged)
- `Chat.Read.All` - Read all chat messages across tenant for webhook change subscriptions
- `User.Read.All` - Read user profiles to resolve Entra IDs, display names, and external guests

### Grant Admin Consent
Click **Grant admin consent for <Tenant>** and verify all permissions display green checkmarks.

---

## 3. Backend Environment Variables (`.env`)

```dotenv
# Feature flag (default false until admin consent and webhook URL are active)
TEAMS_SYNC_ENABLED=false

# Microsoft Entra credentials
TEAMS_CLIENT_ID=your-entra-application-client-id
TEAMS_CLIENT_SECRET=your-entra-client-secret-value
TEAMS_TENANT_ID=your-entra-directory-tenant-id

# Webhook configuration (must be valid HTTPS URL)
TEAMS_WEBHOOK_URL=https://api.yourdomain.com/api/integration/teams/webhook
TEAMS_WEBHOOK_CLIENT_STATE=your-secure-random-client-state-secret

# Server-side AES-256 token encryption key
TEAMS_ENCRYPTION_KEY=your-secure-32-byte-token-encryption-key
```

> **Security Note**: All secrets, client secrets, refresh tokens, and webhook secrets are maintained server-side only. Refresh tokens are encrypted with AES-256-GCM in MongoDB.

---

## 4. Webhook URL & Handshake

- **Endpoint**: `POST /api/integration/teams/webhook`
- **Validation**: Automatically responds to Graph validation handshake query param (`?validationToken=...`) with 200 OK and plaintext token.
- **Payloads**: Receives change notifications, validates `clientState`, checks for idempotency, and drops echo loops.

---

## 5. Manual Test Checklist

- [ ] **Feature Flag Off**: Send Portal chat message with `TEAMS_SYNC_ENABLED=false`; verify standard chat functionality is unaffected.
- [ ] **Webhook Validation**: Send a mock handshake: `POST /api/integration/teams/webhook?validationToken=abc12345` -> returns `abc12345`.
- [ ] **Account Linking**: Log into Portal via Microsoft sign-in; verify `Account.microsoftId` and `TeamsUserMapping` exist.
- [ ] **Portal → Teams**: Send a direct message in Portal; confirm message appears in native Microsoft Teams 1-to-1 chat.
- [ ] **Teams → Portal**: Reply in Teams; confirm message appears in Portal direct conversation in real time via Socket.IO.
- [ ] **Unread & Notification**: Confirm unread badge increments and Portal notification is created for inbound Teams messages.
- [ ] **Echo Prevention**: Confirm messages sent from Portal are ignored when returning via Microsoft Graph webhook notifications.
- [ ] **External Guest**: Confirm messages from external guests/customers create a direct conversation with the guest's identity.
