# Microsoft Teams Chat Integration - Phase 1 Setup & Operation Guide

This document details the architecture, Entra ID app configuration, permissions, environment setup, and verification checklist for Phase 1 of native Microsoft Teams 1-to-1 chat synchronization with LNG Portal Chat.

---

## 1. Overview & Architecture

### Purpose
Synchronize native Microsoft Teams 1-to-1 direct chats with LNG Portal Chat in real time:
- **Portal → Teams (Outbound)**: A message sent in a Portal direct chat is delivered to the matching native Teams direct chat.
- **Teams → Portal (Inbound)**: A message sent in Teams arrives via Microsoft Graph change notifications (webhooks), creates/appends to the Portal direct conversation in real time, updates unread counters, and triggers Portal notifications.
- **External Customers / Guests**: Conversations involving external guest users exposed by Teams are linked into direct conversations in Portal.
- **Idempotency & Echo Prevention**: Mappings track every synced message; webhook notifications resulting from outbound Portal messages are recognized and dropped to prevent echo loops.
- **Zero Disruption**: Sync is controlled by the `TEAMS_SYNC_ENABLED` feature flag (default `false`). When disabled, native Portal chat behavior is 100% unaffected.

---

## 2. Microsoft Entra ID (Azure AD) App Registration

### 2.1 Basic App Configuration
1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) or Azure Portal.
2. Navigate to **Identity** → **Applications** → **App registrations**.
3. Select your existing LNG Portal Application (or click **New registration**).
4. **Supported account types**:
   - For internal-only employee organization: `Accounts in this organizational directory only (Single tenant)`.
   - For multi-tenant or external guest support: `Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)`.
5. **Redirect URIs**:
   - **SPA (Single-Page Application)**: `https://<PORTAL_DOMAIN>/` (matches MSAL browser origin).
   - **Web**: `https://<API_DOMAIN>/api/integration/teams/oauth/callback` (optional server OAuth exchange).

### 2.2 Client Credentials (Secret)
1. Go to **Certificates & secrets** → **Client secrets** → **New client secret**.
2. Provide a description (e.g. `LNG Portal Teams Chat Sync`) and expiration period.
3. Copy the **Value** immediately (this will only be displayed once) into your server `.env` as `TEAMS_CLIENT_SECRET`.

---

## 3. Required Microsoft Graph Permissions & Admin Consent

To achieve native 1-to-1 direct messaging and real-time webhook subscriptions with the principle of least privilege, configure the following:

### 3.1 Delegated Permissions (User Context)
Used to post 1-on-1 messages as the user (`ChatMessage.Send` requires delegated scope in Microsoft Graph):
- `ChatMessage.Send`: Allows the app to send 1-to-1 chat messages on behalf of the signed-in employee.
- `Chat.ReadWrite`: Allows the app to find, create, and manage 1-to-1 chats for the user.
- `User.Read`: Read employee profile and basic identity.
- `offline_access`: Allows acquiring refresh tokens for server-side dispatch when the user is offline.
- `openid`, `profile`, `email`: Standard OpenID Connect scopes.

### 3.2 Application Permissions (App-Only / Background Service Context)
Used for webhook subscription lifecycle (`/chats/getAllMessages`) and processing incoming webhook notifications:
- `Chat.Read.All`: Allows the backend service to subscribe to chat change notifications across the tenant and fetch message content upon notification.
- `User.Read.All`: Allows resolving user Entra Object IDs, UPNs, display names, and external guest metadata.

### 3.3 Admin Consent Steps
1. In the Entra Admin Center, navigate to **API permissions**.
2. Click **Add a permission** → **Microsoft Graph**.
3. Select **Delegated permissions** and check:
   - `ChatMessage.Send`
   - `Chat.ReadWrite`
   - `User.Read`
   - `offline_access`
4. Click **Add a permission** → **Microsoft Graph** → **Application permissions** and check:
   - `Chat.Read.All`
   - `User.Read.All`
5. Click **Grant admin consent for <Your Organization>**.
6. Verify that all permissions show a green checkmark under the **Status** column.

---

## 4. Environment Variables (`.env`)

Add the following environment variables to your backend `.env` file:

```dotenv
# Feature Flag (Keep false until Entra Admin Consent and HTTPS Webhook are verified)
TEAMS_SYNC_ENABLED=false

# Microsoft Entra Credentials
TEAMS_CLIENT_ID=00000000-0000-0000-0000-000000000000
TEAMS_CLIENT_SECRET=your_entra_app_client_secret_value
TEAMS_TENANT_ID=00000000-0000-0000-0000-000000000000

# Webhook Configuration (Must be publicly accessible HTTPS URL)
TEAMS_WEBHOOK_URL=https://api.yourdomain.com/api/integration/teams/webhook
TEAMS_WEBHOOK_CLIENT_STATE=your-custom-secure-random-client-state-secret

# Server-Side AES-256 Token Encryption Key (32 bytes or strong secret)
TEAMS_ENCRYPTION_KEY=your-secure-32-byte-token-encryption-key
```

> **Security Rule**: Refresh tokens, client secrets, and webhook secrets are stored strictly server-side. Refresh tokens in the database are encrypted at rest with AES-256-GCM. Never expose these values in frontend code, client responses, git commits, or debug logs.

---

## 5. Webhook Endpoints & Lifecycle

### Webhook URL
- Endpoint: `POST /api/integration/teams/webhook`
- Publicly accessible over HTTPS (Microsoft Graph does not allow self-signed certificates or HTTP).
- In development/staging, use a reverse proxy or tunnel (such as Cloudflare Tunnel or ngrok) with a valid HTTPS certificate.

### Handshake & Processing
1. **Validation Handshake**: When creating or renewing a subscription, Microsoft Graph sends:
   `POST /api/integration/teams/webhook?validationToken=<token>`
   The endpoint immediately returns HTTP 200 with `Content-Type: text/plain` and `<token>` as the response body.
2. **Notification Delivery**: Graph delivers message change events in JSON payload `value: [...]`.
   The endpoint immediately returns `202 Accepted` and processes the events asynchronously.
3. **Subscription Renewal**: Subscriptions for `/chats/getAllMessages` expire every ~3 days. The service provides `teamsSyncService.ensureWebhookSubscription()` to register or renew active subscriptions.

---

## 6. Manual Test Checklist

Use this checklist to verify Phase 1 synchronization before enabling in production:

| Step | Action | Expected Result | Pass? |
| :--- | :----- | :-------------- | :---- |
| **1. Feature Flag Off** | Send chat message in Portal with `TEAMS_SYNC_ENABLED=false`. | Normal Portal chat flow works; no Graph calls or errors. | [ ] |
| **2. Webhook Handshake** | Run: `curl -i -X POST "https://<HOST>/api/integration/teams/webhook?validationToken=verify-token-123"` | Returns `HTTP/1.1 200 OK`, `Content-Type: text/plain`, body `verify-token-123`. | [ ] |
| **3. Account Linking** | User logs into Portal with Microsoft sign-in. | `Account.microsoftId` is populated and `TeamsUserMapping` is created with `entraUserId`. | [ ] |
| **4. Portal → Teams** | Send a text message from Portal direct conversation to a colleague who has Teams linked. | Message appears in native Microsoft Teams client in the 1-to-1 chat with matching content. | [ ] |
| **5. Teams → Portal** | Colleague replies with a text message in native Microsoft Teams. | Message appears in Portal direct conversation in real time via Socket.IO. | [ ] |
| **6. Unread & Notification** | Receive a Teams message while Portal chat is closed/inactive. | Unread counter badge increments and a Portal notification is created. | [ ] |
| **7. Echo Loop Check** | Send message from Portal → arrives in Teams → Graph webhook fires. | Backend recognizes the `teamsMessageId` in `TeamsMessageMapping` and ignores the duplicate notification. | [ ] |
| **8. External Guest Chat** | Chat with an external guest/customer in Teams. | Direct conversation is created in Portal with guest display name / external mapping. | [ ] |
| **9. Graceful Degradation** | Trigger message when Microsoft Graph API is unreachable. | Portal chat message succeeds; backend logs structured warning without crashing. | [ ] |
