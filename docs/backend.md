# Backend Documentation

The backend is an Express.js + TypeScript server that orchestrates WhatsApp and Google API interactions.

## Entry Point (`server/main.ts`)

The Express app initializes with the following middleware chain (in order):

1. **CORS** — Origin from `ORIGIN` env var, credentials enabled
2. **Body Parser** — JSON request body parsing
3. **Cookie Parser** — Signed cookies using `SESSION_SECRET`
4. **Express Session** — In-memory store with 24-hour TTL, pruned every 24 hours
5. **Custom CORS headers** — Explicit header pass-through for proxy setups
6. **Winston logger** — JSON-formatted request logging to console

Key configuration:
- Port: `8080`
- Trust proxy enabled in production (`NODE_ENV=production`)
- ETags disabled to prevent 304 caching issues
- Routes mounted at optional `ROUTE_PREFIX`

## API Routes (`server/routes/api.ts`)

### REST Endpoints

#### `GET /status`
Returns the current session state. Called by the frontend router guard on every navigation.

**Response:** `SessionStatus`
```typescript
{
  whatsappConnected: boolean,  // WhatsApp client in CONNECTED state
  googleConnected: boolean,    // Google OAuth token cached
  enforcePayments: boolean,    // Payment gate enabled
  purchased: boolean           // User has valid purchase
}
```

#### `GET /init_whatsapp`
Initializes a new WhatsApp Web client. Destroys any existing client first.

- Creates headless Chromium instance via Puppeteer
- Registers event handlers for QR code, loading, and ready states
- Stores client in session cache

**Response:** `{}`

#### `POST /init_gapi`
Stores the Google OAuth token received from the frontend.

**Request body:**
```typescript
{ token: GoogleOAuthAccessToken }
```

**Response:** Redirect to `/options`

#### `GET /init_sync`
Starts the sync process asynchronously (fire-and-forget). Progress is communicated via WebSocket.

**Query params:** `manual_sync`, `overwrite_photos` (both `"true"` or `"false"`)

**Response:** `{}`

#### `POST /check_purchase`
Verifies a BuyMeACoffee purchase by email.

**Request body:** `{ email: string }`
**Response:** `{ purchased: boolean }`

### WebSocket Handler

#### `WS /ws`
Establishes a bidirectional WebSocket connection per session.

On connect:
- Cancels any pending cleanup timeout (handles reconnection)
- Stores WebSocket reference in session cache

On disconnect:
- Schedules cleanup after 5 minutes (destroy WhatsApp client, clear auth, clear WS)

## WhatsApp Module (`server/src/whatsapp.ts`)

### Client Configuration

```typescript
const wwebVersion = "2.2407.3";
// Puppeteer options:
//   - Docker: uses /usr/bin/chromium-browser
//   - Local: auto-detects Chromium
//   - Args: --no-sandbox, --disable-setuid-sandbox, --disable-gpu
// Web version cached from GitHub (wppconnect-team/wa-version)
```

### Client Lifecycle

`initWhatsApp(sessionID)` creates a new `Client` with these event handlers:

| Event | Behavior |
|-------|----------|
| `qr` | Sends QR string to frontend via WebSocket (`WhatsAppQR` event) |
| `loading_screen` | Sends `WhatsAppConnecting` event to frontend |
| `ready` | Verifies purchase (if payments enforced), redirects to `/gauth` or `/contribute` |
| `auth_failure` | No-op (silent handler) |

### Contact Loading

`loadContacts(client)` returns a `Map<string, string>`:
- **Key:** Phone number (`contact.id.user`, e.g., `5511987654321`)
- **Value:** Serialized contact ID (`contact.id._serialized`)

### Photo Download

`downloadFile(client, whatsappId)` returns a Base64-encoded profile picture, or `null` if the contact has no photo. Uses `MessageMedia.fromUrl()` internally.

## Google API Module (`server/src/gapi.ts`)

### OAuth Setup

`googleLogin(token)` creates an `OAuth2Client` with:
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from environment
- Credentials set from the frontend-provided token

### Contact Listing

`listContacts(auth)` paginates through Google Contacts (250 per page):

**Requested fields:** `names, emailAddresses, phoneNumbers, photos`

**Filtering:**
- Only contacts with phone numbers
- Only canonical-form phone numbers (strips `+` prefix)

**Returns:** `SimpleContact[]`
```typescript
interface SimpleContact {
  id: string;          // Google resourceName (e.g., "people/c123456")
  name?: string;       // Display name
  numbers: string[];   // Canonical phone numbers without "+"
  hasPhoto: boolean;   // true if contact has a non-default photo
  photoUrl?: string;   // Primary photo URL
}
```

### Photo Update

`updateContactPhoto(auth, resourceName, photoBase64)` uploads a Base64-encoded image as the contact's photo. Errors are logged but not thrown.

## Sync Engine (`server/src/sync.ts`)

The sync engine is the core business logic. It runs asynchronously after `GET /init_sync`.

### Algorithm

1. **Load contacts** from both Google and WhatsApp
2. **Shuffle** Google contacts (spreads progress across the UI)
3. **Iterate** each Google contact:
   - Skip contacts with existing photos (unless `overwrite_photos=true` or manual mode)
   - Try to match each phone number against WhatsApp contacts
   - Apply Brazilian number fallback if direct match fails
   - Download WhatsApp profile photo
   - In manual mode: send `SyncConfirm`, wait for `SyncPhotoConfirm` response (30s timeout)
   - In auto mode: upload directly
   - Send `SyncProgress` event
4. **Complete** — send 100% progress, close WebSocket

### Phone Number Matching

```
Google number: "5511987654321" (canonical, no +)
WhatsApp map:  { "5511987654321" => "5511987654321@c.us" }

Step 1: Direct lookup in WhatsApp map
Step 2: If no match and starts with "55" (Brazil):
  - 12 digits → insert "9" at position 4:  "551133334444" → "5511933334444"
  - 13 digits → remove "9" at position 5:  "5511933334444" → "551133334444"
```

### Rate Limiting

Uses `limiter` library with token bucket: 1 token per 1500ms. This caps photo uploads at ~40/min, safely under Google's 60/min limit.

### Manual Sync Flow

In manual mode, the server sends a `SyncConfirm` event containing:
- `existingPhoto` — current Google Contact photo (Base64, fetched from `photoUrl`)
- `newPhoto` — WhatsApp profile photo (Base64)
- `contactName` — display name

It then waits up to 30 seconds for a `SyncPhotoConfirm` response with `{ accept: boolean }`. If the user accepts, the photo is uploaded.

## Cache System (`server/src/cache.ts`)

```typescript
LRUCache({ max: 4096, ttl: 3600000 }) // 1 hour
```

**Key format:** `{sessionID}-{key}`

**Per-session entries:**

| Key | Type | Description |
|-----|------|-------------|
| `whatsapp` | `Client` | WhatsApp Web.js client instance |
| `gauth` | `OAuth2Client` | Google OAuth2 credentials |
| `ws` | `WebSocket` | Active WebSocket connection |
| `email` | `string` | User email (for payment verification) |
| `purchased` | `boolean` | Payment verification result |
| `cleanup` | `Timeout` | Pending cleanup timer |

## WebSocket Utilities (`server/src/ws.ts`)

### `sendEvent(ws, eventType, data?)`
Serializes and sends a JSON event: `{ type, data }`.

### `sendMessageAndWait(ws, sendType, waitType, message)`
Sends an event and returns a Promise that resolves when the client responds with the expected event type. Times out after 30 seconds.

Used for manual sync confirmation — the server asks the user a question and blocks until they respond.

## Payments Module (`server/src/payments.ts`)

Optional module, active when `ENFORCE_PAYMENTS=true`.

### Two-Tier Cache
1. **In-memory:** `Map<email, whatsappId>` for fast lookups
2. **Redis:** Persistent storage with 31-day TTL

### Flow
1. User buys on BuyMeACoffee
2. `checkPurchase(email)` fetches recent supporters from the API
3. On first WhatsApp login, `verifyPurchaseWAId(email, waId)` binds the email to a WhatsApp account
4. Subsequent logins verify the WhatsApp ID matches (prevents account sharing)

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENFORCE_PAYMENTS` | `"false"` | Enable payment verification |
| `COFFEE_TOKEN` | — | BuyMeACoffee API bearer token |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection for persistent purchase data |

## Error Handling Patterns

The backend uses several error handling approaches:

1. **Try-catch with WebSocket error events** (sync.ts) — errors during sync are sent to the frontend as `SyncProgress` events with an `error` field
2. **Silent catch with logging** (gapi.ts) — photo update errors are logged but don't break the sync loop
3. **No-op handlers** (whatsapp.ts `auth_failure`) — some events are silently consumed
4. **Winston request logging** — all HTTP requests logged to console in JSON format
