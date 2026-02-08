# Architecture Overview

WhatsApp Contact Sync is a full-stack web application that syncs WhatsApp profile pictures to Google Contacts by matching phone numbers.

## System Diagram

```
                                     +-------------------+
                                     |   Google People   |
                                     |       API         |
                                     +--------+----------+
                                              ^
                                              | OAuth2 + REST
                                              |
+----------+       +---------+       +--------+----------+
|          | HTTP  |         | Proxy |                    |
|  Browser +------>+  Nginx  +------>+  Express Server    |
|  (Vue 3) | :80   | Static  | :8080 |                    |
|          +<----->+ + Proxy  +<---->+  - Session Cache   |
|          |  WS   |         |  WS   |  - Rate Limiter    |
+----------+       +---------+       |  - Sync Engine     |
                                     +--------+----------+
                                              |
                                              | Puppeteer (Chromium)
                                              |
                                     +--------+----------+
                                     |   WhatsApp Web    |
                                     |   (headless)      |
                                     +-------------------+
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Vue 3 + TypeScript | SPA with router-driven auth flow |
| Styling | TailwindCSS + DaisyUI | Utility-first CSS with component library |
| Build | Vite | Dev server with HMR and proxy |
| Backend | Express + TypeScript | REST API + WebSocket server |
| WhatsApp | whatsapp-web.js + Puppeteer | Headless WhatsApp Web client |
| Google | googleapis (People API) | Contact listing and photo updates |
| Caching | LRU Cache (in-memory) | Session data: WA clients, auth, WS |
| Payments | BuyMeACoffee API + Redis | Optional purchase verification |
| Infra | Docker + Nginx | Multi-stage builds, reverse proxy |

## User Flow

```
Home ──> WhatsApp Auth ──> Google Auth ──> Options ──> Sync
  │       (QR scan)       (OAuth 2.0)    (settings)  (real-time)
  │
  └──> Contribute (payment gate, optional)
```

1. **Home** - Landing page, checks backend availability via WebSocket
2. **WhatsApp Auth** - Displays QR code, user scans with WhatsApp mobile
3. **Google Auth** - OAuth 2.0 consent for `contacts` scope
4. **Options** - Choose manual or auto sync, overwrite existing photos
5. **Sync** - Real-time progress via WebSocket, photo previews

## Key Design Decisions

### Session-Driven State (No Frontend Store)

There is no Vuex/Pinia store. All critical state lives in the backend session cache. The frontend checks `/api/status` on every route change and the router guard enforces the correct flow. This keeps the frontend stateless and avoids sync issues between browser and server.

### LRU Cache for Session Data

Each user session stores a WhatsApp client instance, Google OAuth credentials, and a WebSocket connection in an LRU cache (max 4096 entries, 1-hour TTL). This bounds memory usage while supporting concurrent users. The WhatsApp client is the most expensive resource — it runs a headless Chromium instance.

### WebSocket for Real-Time Communication

The sync process runs server-side and pushes progress events to the frontend via WebSocket. This enables:
- QR code delivery (WhatsApp auth)
- Sync progress streaming (percentage, synced photos)
- Manual sync confirmation (show two photos, wait for user choice)
- Navigation commands (redirect events)

### Rate Limiting

Google People API allows ~60 photo updates per minute. The sync engine uses a token bucket rate limiter at 1 request per 1.5 seconds (40/min) to stay safely under the limit.

### Phone Number Matching

Contacts are matched by phone number. Google Contacts provides canonical phone numbers (e.g., `+5511987654321`), while WhatsApp uses numbers without the `+` prefix. The matching algorithm:

1. **Direct match** — strip `+` from Google number, look up in WhatsApp contacts map
2. **Brazilian fallback** — handles the 9th digit transition:
   - 12-digit number (old format): insert `9` after area code
   - 13-digit number (new format): remove `9` after area code

### Graceful Cleanup

When a WebSocket disconnects, the server waits 5 minutes before destroying the WhatsApp client. This handles page refreshes and brief disconnects without requiring re-authentication.

## Shared Types

The `interfaces/api.ts` file is imported by both frontend and backend, ensuring type safety across the WebSocket protocol:

- `EventType` — enum of all WebSocket event types
- `Event` — `{ type: EventType, data: any }`
- `SessionStatus` — auth state checked by router guards
- `SyncProgress` — progress updates during sync
- `SyncOptions` — user-selected sync configuration

## Data Flow: Sync Process

```
1. Frontend: GET /api/init_sync?manual_sync=false&overwrite_photos=true
2. Server: Load Google contacts (paginated, 250/page)
3. Server: Load WhatsApp contacts (phone → ID map)
4. Server: Shuffle contacts (spread progress evenly)
5. For each Google contact:
   a. Match phone number against WhatsApp contacts
   b. Download WhatsApp profile photo (Base64)
   c. [Manual mode] Send SyncConfirm event, wait for user response
   d. Upload photo to Google Contacts via People API
   e. Rate limit: wait for token (1.5s interval)
   f. Send SyncProgress event to frontend
6. Server: Send final 100% progress, close WebSocket
```

## Project Structure

```
whatsapp-contact-sync/
├── interfaces/api.ts        # Shared TypeScript types
├── server/                  # Express backend
│   ├── main.ts              # Entry point, middleware
│   ├── routes/api.ts        # REST + WebSocket endpoints
│   └── src/
│       ├── sync.ts          # Core sync logic
│       ├── whatsapp.ts      # WhatsApp client lifecycle
│       ├── gapi.ts          # Google People API
│       ├── cache.ts         # LRU session cache
│       ├── ws.ts            # WebSocket utilities
│       └── payments.ts      # Payment verification
├── web/                     # Vue 3 frontend
│   ├── src/
│   │   ├── main.ts          # Router, guards, analytics
│   │   ├── pages/           # Route components
│   │   ├── components/      # Header, Footer
│   │   └── services/ws.ts   # WebSocket client
│   └── vite.config.ts       # Dev proxy config
├── assets/
│   ├── nginx.conf           # Production reverse proxy
│   └── entrypoint.sh        # Docker startup script
└── Dockerfile               # Multi-stage full build
```
