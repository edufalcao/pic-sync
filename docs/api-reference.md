# API Reference

All REST endpoints are served from the Express backend on port 8080. In production, Nginx proxies `/api/*` to the backend (stripping the `/api` prefix). In development, Vite's proxy does the same.

All requests use `credentials: "include"` for cookie-based session management.

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
| `googleConnected` | `boolean` | Google OAuth token exists in cache |
| `enforcePayments` | `boolean` | Payment gate is enabled server-side |
| `purchased` | `boolean` | User has verified purchase (or payments not enforced) |

---

### GET `/init_whatsapp`

Initializes a WhatsApp Web client. Destroys any existing client for this session first.

**Response:** `{}`

**Side effects:**
- Creates a headless Chromium instance
- Begins emitting WebSocket events (`WhatsAppQR`, `WhatsAppConnecting`, `Redirect`)

---

### POST `/init_gapi`

Stores the Google OAuth access token in the server session.

**Request body:**
```json
{
  "token": {
    "access_token": "ya29.a0...",
    "token_type": "Bearer",
    "expires_in": 3599,
    "scope": "https://www.googleapis.com/auth/contacts"
  }
}
```

**Response:** Redirect to `/options`

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
  numbers: string[];   // Canonical phone numbers (no "+")
  hasPhoto: boolean;   // Has non-default photo
  photoUrl?: string;   // Primary photo URL
}
```
