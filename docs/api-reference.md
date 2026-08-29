# API Reference

All REST endpoints are served from the Express backend on port 8080. In production, Nginx proxies `/api/*` to the backend (stripping the `/api` prefix). In development, Vite's proxy does the same.

All requests use `credentials: "include"` for cookie-based session management.

Two cookies drive state:

| Cookie | Purpose |
|--------|---------|
| `connect.sid` | Express session (24h) — keys the in-memory session cache |
| `uid` | Long-lived (1yr, httpOnly) stable identifier — keys all persisted on-disk state |

## REST Endpoints

### GET `/status`

Returns the current session state.

**Response:**
```json
{
  "whatsappConnected": true,
  "googleConnected": false,
  "enforcePayments": false,
  "purchased": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `whatsappConnected` | `boolean` | WhatsApp client is in `CONNECTED` state |
| `googleConnected` | `boolean` | Google OAuth client in cache, or a persisted refresh token was found and the client was rebuilt |
| `enforcePayments` | `boolean` | Payment gate is enabled server-side |
| `purchased` | `boolean` | User has verified purchase (or payments not enforced) |

---

### GET `/init_whatsapp`

Initializes a WhatsApp Web client. Destroys any existing client for this session first. The client uses `LocalAuth` keyed by the `uid` cookie, so a previously linked session restores from disk without a QR scan.

**Response:** `{}`

**Side effects:**
- Creates a headless Chromium instance
- Begins emitting WebSocket events (`WhatsAppQR`, `WhatsAppConnecting`, `Redirect`)

---

### GET `/google_auth_start`

Begins the server-side OAuth 2.0 authorization code flow. Generates a CSRF `state` token (stored in the session cache), builds the Google consent URL with the `contacts` scope and `access_type=offline`, and 302-redirects the browser to it.

**Response:** `302` redirect to `accounts.google.com`

---

### GET `/google_callback`

OAuth 2.0 redirect target (must be registered as an Authorized Redirect URI). Validates the `state` parameter, exchanges the authorization code for tokens, persists the refresh token on disk keyed by `uid`, caches the authorized client in the session, and redirects to `/options`.

**Query parameters:** `code`, `state`, `error` (set by Google on denial)

**Response:** `302` redirect to `/options` on success, or `/?error=...` on failure

---

### POST `/logout`

Disconnects one or both accounts. This is the **only** path that deletes persisted state.

**Request body:**
```json
{
  "scope": "all"
}
```

| Param | Values | Actions |
|-------|--------|---------|
| `scope` | `"whatsapp"` | Destroys the WhatsApp client, deletes the on-disk `LocalAuth` session (next connect requires a QR scan) |
| | `"google"` | Revokes the Google grant at `oauth2.googleapis.com/revoke`, deletes the stored refresh token |
| | `"all"` (default) | Both of the above |

Also cancels any pending WS cleanup timer, closes the WebSocket, clears session cache entries, and rotates the session ID.

**Response:** `{}`

---

### GET `/init_sync`

Starts the sync process asynchronously. Progress is communicated via WebSocket events.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `manual_sync` | `"true" \| "false"` | — | Enable manual photo-by-photo approval |
| `overwrite_photos` | `"true" \| "false"` | — | Replace existing Google Contact photos |

**Response:** `{}`

---

### POST `/check_purchase`

Verifies a BuyMeACoffee purchase by email address.

**Request body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "purchased": true
}
```

---

## WebSocket Protocol

### Connection

**Endpoint:** `WS /ws`

The WebSocket connection is established per session. The server uses it to push events and, in manual sync mode, to receive responses.

**Message format** (both directions):
```json
{
  "type": "event_type_string",
  "data": { ... }
}
```

### Server → Client Events

#### `whatsapp_qr`

Sent when a new QR code is available for scanning.

```json
{
  "type": "whatsapp_qr",
  "data": "2@ABC123...base64-qr-string"
}
```

The `data` field is a string suitable for rendering as a QR code.

---

#### `whatsapp_connecting`

Sent when the WhatsApp client begins connecting after QR scan.

```json
{
  "type": "whatsapp_connecting",
  "data": null
}
```

---

#### `redirect`

Instructs the frontend to navigate to a path.

```json
{
  "type": "redirect",
  "data": "/gauth"
}
```

Used after WhatsApp authentication completes (redirects to `/gauth` or `/contribute?show_error=true`).

---

#### `sync_progress`

Periodic progress updates during the sync process.

```json
{
  "type": "sync_progress",
  "data": {
    "progress": 45.5,
    "syncCount": 12,
    "totalContacts": 150,
    "image": "base64-encoded-photo...",
    "error": null,
    "isManualSync": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `progress` | `number` | 0-100 percentage |
| `syncCount` | `number` | Number of photos synced so far |
| `totalContacts` | `number?` | Total Google contacts being processed |
| `image` | `string?` | Base64-encoded last synced photo |
| `error` | `string?` | Error message if something failed |
| `isManualSync` | `boolean?` | Whether manual sync mode is active |

The final event has `progress: 100` and the WebSocket is closed afterward.

---

#### `sync_confirm`

Sent in manual sync mode. Asks the user to approve or reject a photo update.

```json
{
  "type": "sync_confirm",
  "data": {
    "existingPhoto": "base64-existing...",
    "newPhoto": "base64-new...",
    "contactName": "John Doe"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `existingPhoto` | `string?` | Current Google Contact photo (Base64), null if none |
| `newPhoto` | `string` | WhatsApp profile photo (Base64) |
| `contactName` | `string?` | Contact display name |

The server blocks until it receives a `sync_photo_confirm` response (30-second timeout).

---

### Client → Server Events

#### `sync_photo_confirm`

User response to a `sync_confirm` event in manual sync mode.

```json
{
  "type": "sync_photo_confirm",
  "data": {
    "accept": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `accept` | `boolean` | `true` to update the photo, `false` to skip |

---

## Shared Types (`interfaces/api.ts`)

```typescript
enum EventType {
  WhatsAppQR = "whatsapp_qr",
  WhatsAppConnecting = "whatsapp_connecting",
  Redirect = "redirect",
  SyncProgress = "sync_progress",
  SyncConfirm = "sync_confirm",
  SyncPhotoConfirm = "sync_photo_confirm",
}

interface Event {
  type: EventType;
  data: any;
}

interface SyncProgress {
  progress: number;
  syncCount: number;
  totalContacts?: number;
  image?: string;
  error?: string;
  isManualSync?: boolean;
}

interface SessionStatus {
  whatsappConnected: boolean;
  googleConnected: boolean;
  enforcePayments: boolean;
  purchased: boolean;
}

interface SyncOptions {
  overwrite_photos?: string;
  manual_sync?: string;
}
```

## Internal Types (`server/src/interfaces.ts`)

```typescript
interface SimpleContact {
  id: string;          // Google resourceName
  name?: string;       // Display name
  numbers: string[];   // Phone numbers: E.164 canonicalForm when Google could parse, else raw value (no "+")
  hasPhoto: boolean;   // Has non-default photo
  photoUrl?: string;   // Primary photo URL
}
```
