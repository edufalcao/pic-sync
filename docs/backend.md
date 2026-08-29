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
7. **`uid` cookie middleware** — Assigns every browser a stable 48-char hex identifier (1 year, httpOnly), exposed to handlers as `req.uid`. All persisted on-disk state is keyed by this cookie because the express `sessionID` changes whenever the in-memory store is lost (e.g. restart)

Environment variables are loaded via Node's built-in `--env-file=.env` flag in the `dev`/`serve` npm scripts (no dotenv dependency; production in Docker uses `docker run --env-file`).

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
  googleConnected: boolean,    // Google client cached, or rebuilt from the persisted refresh token
  enforcePayments: boolean,    // Payment gate enabled
  purchased: boolean           // User has valid purchase
}
```

On a `gauth` cache miss, `/status` attempts to rebuild the OAuth client from the refresh token persisted on disk (see `getOAuth2ClientFromStorage`), so the Google connection survives restarts and cache expiry.

#### `GET /init_whatsapp`
Initializes a new WhatsApp Web client. Destroys any existing client first.

- Creates headless Chromium instance via Puppeteer
- Uses `LocalAuth({ clientId: uid, dataPath: ".wwebjs_auth" })` — previously linked sessions restore from disk without a QR scan
- Registers event handlers for QR code, loading, and ready states
- Stores client in session cache

**Response:** `{}`

#### `GET /google_auth_start`
Begins the server-side OAuth 2.0 authorization code flow: generates a CSRF `state`, builds the consent URL (`contacts` scope, `access_type=offline`, `prompt=consent`), and redirects the browser to Google. The redirect URI is built from the incoming request's protocol and host.

**Response:** `302` to `accounts.google.com`

#### `GET /google_callback`
Exchanges the authorization code for tokens after validating `state`. Persists the refresh token on disk (keyed by `uid`) and caches the authorized client in the session.

**Response:** `302` to `/options` on success; `/?error=google_auth_denied|invalid_state|google_token_exchange_failed` on failure

#### `POST /logout`
Disconnects accounts. `scope` in the JSON body: `"whatsapp"`, `"google"`, or `"all"` (default).

- **whatsapp** — destroys the client and deletes the on-disk `LocalAuth` session (`deleteWhatsAppAuth`), so the next connect requires a fresh QR scan
- **google** — revokes the token at `oauth2.googleapis.com/revoke` and deletes the stored refresh token
- Both — cancels pending WS cleanup, closes the WebSocket, clears session cache entries, rotates the session ID

This is the **only** path that deletes persisted state.

**Response:** `{}`

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

`initWhatsApp(sessionID, uid)` creates a new `Client` with a `LocalAuth` strategy keyed by `uid` (sessions persist under `.wwebjs_auth/session-<uid>`) and these event handlers:

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

`downloadFile(client, whatsappId)` returns a Base64-encoded profile picture, or `null` if the contact has no photo (or resolution fails — errors are logged and swallowed so one bad contact can't abort a sync).

Photo URLs are resolved via `resolveProfilePicUrl()`, which evaluates inside the WhatsApp Web page and tries three strategies in order: the contact model, the chat model, then the raw wid — `client.getProfilePicUrl()` alone fails for contacts without an open chat.

## Google API Module (`server/src/gapi.ts`)

### OAuth Flow (server-side authorization code)

| Function | Purpose |
|----------|---------|
| `generateGoogleAuthUrl(redirectUri, state)` | Builds the consent URL (`contacts` scope, `access_type=offline`, `prompt=consent`) |
| `getOAuth2ClientFromCode(uid, code, redirectUri)` | Exchanges the code for tokens, caches the client, persists the refresh token via `persist.ts` |
| `getOAuth2ClientFromStorage(uid)` | Rebuilds an authorized client from the stored refresh token (returns `null` if none) |
| `revokeGoogleAccess(uid)` | Revokes the grant at `oauth2.googleapis.com/revoke` and deletes the stored token |

### Contact Listing

`listContacts(auth)` paginates through Google Contacts (250 per page):

**Requested fields:** `names, emailAddresses, phoneNumbers, photos`

**Filtering:**
- Only contacts with phone numbers
- Numbers keep the E.164 `canonicalForm` when Google could parse them; otherwise the raw `value` is kept (so locally-formatted numbers can be normalized later against the user's region instead of being dropped)

**Returns:** `SimpleContact[]`
```typescript
interface SimpleContact {
  id: string;          // Google resourceName (e.g., "people/c123456")
  name?: string;       // Display name
  numbers: string[];   // E.164 canonicalForm or raw value
  hasPhoto: boolean;   // true if contact has a non-default photo
  photoUrl?: string;   // Primary photo URL
}
```

### Photo Update

`updateContactPhoto(auth, resourceName, photoBase64)` uploads a Base64-encoded image as the contact's photo. Transient errors (HTTP 5xx, 429) are retried up to 5 times with linear backoff (2s, 4s, 6s, 8s); non-retryable errors and exhausted retries are **thrown**, so the sync engine's per-contact catch can log them and move on without counting the contact as synced.

## Sync Engine (`server/src/sync.ts`)

The sync engine is the core business logic. It runs asynchronously after `GET /init_sync`.

### Algorithm

1. **Load contacts** from both Google and WhatsApp
2. **Infer region** from the syncing user's own WhatsApp country code (`inferRegion`)
3. **Shuffle** Google contacts (spreads progress across the UI)
4. **Iterate** each Google contact (guarded by a per-contact try/catch so one failure can't kill the whole un-awaited run):
   - Skip contacts with existing photos (unless `overwrite_photos=true` or manual mode)
   - For each phone number, try `matchCandidates(number, region)` — normalized E.164 plus country-specific legacy spellings — against the WhatsApp map
   - Download WhatsApp profile photo
   - In manual mode: send `SyncConfirm`, wait for `SyncPhotoConfirm` response (30s timeout)
   - In auto mode: upload directly (with transient-error retry)
   - Send `SyncProgress` event
5. **Complete** — send 100% progress, close WebSocket

### Phone Number Matching (`server/src/phone.ts`)

Normalization and candidate generation live in a dedicated module with unit tests (`phone.test.ts`, run via `npm test`):

```
Google number: "+55 11 3333-4444" (raw value without +CC)
Step 1: Normalize with libphonenumber-js against the inferred region → E.164 digits
Step 2: Generate candidates: the normalized form plus country-specific legacy
        variants (e.g. country code 55: 12-digit spellings with the 9th digit
        removed, 13-digit spellings with it inserted)
Step 3: First candidate present in the WhatsApp contacts map wins
```

The WhatsApp map is double-indexed (raw `contact.id.user` digits and their E.164 normalization) so either side can be in legacy format.

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
LRUCache({ max: 4096, ttl: 3600000, updateAgeOnGet: true }) // 1hr sliding TTL
```

`updateAgeOnGet` slides the expiry window on every read, so sessions actively syncing don't get dropped after an hour.

**Key format:** `{sessionID}-{key}`

**Per-session entries:**

| Key | Type | Description |
|-----|------|-------------|
| `whatsapp` | `Client` | WhatsApp Web.js client instance |
| `gauth` | `OAuth2Client` | Google OAuth2 credentials (rebuildable from disk) |
| `ws` | `WebSocket` | Active WebSocket connection |
| `email` | `string` | User email (for payment verification) |
| `purchased` | `boolean` | Payment verification result |
| `cleanup` | `Timeout` | Pending cleanup timer |
| `oauth_state` | `string` | CSRF state for the OAuth flow (single use) |

## Persistence Store (`server/src/persist.ts`)

File-based store at `.data/persist.json`, keyed by the `uid` cookie. Holds the Google refresh token per user so the OAuth client can be rebuilt after restarts or cache expiry. Writes are atomic (temp file + rename). Deliberately file-based rather than Redis: single-node self-hosted app, and Redis is only wired up when `ENFORCE_PAYMENTS` is enabled.

| Function | Purpose |
|----------|---------|
| `getGoogleRefreshToken(uid)` | Read the stored token (undefined if none) |
| `setGoogleRefreshToken(uid, token)` | Persist the token |
| `deleteGoogleRefreshToken(uid)` | Remove it (logout) |

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
2. **Per-contact isolation** (sync.ts) — each contact is wrapped in try/catch so one failure (e.g. a bad photo URL) is logged and skipped without aborting the whole un-awaited sync
3. **Retry with backoff for transient upstream errors** (gapi.ts) — Google 5xx/429 responses are retried up to 5 times; permanent failures are rethrown so the contact is *not* counted as synced
4. **Swallow-and-log for non-fatal failures** (whatsapp.ts photo download) — an unreadable/unavailable profile picture degrades to `null`
5. **No-op handlers** (whatsapp.ts `auth_failure`) — some events are silently consumed
6. **Winston request logging** — all HTTP requests logged to console in JSON format
