# Development Guide

## Prerequisites

- Node.js 20.19+ / 22.12+ (Vite 8 requirement; developed on 24)
- Chromium dependencies (Puppeteer downloads its own Chromium build; system libs like `libnss3`/`libnspr4` must be present — on minimal Linux installs install the standard Chromium dependency set)
- Google Cloud project with People API enabled
- Google OAuth 2.0 credentials (client ID + client secret)

## Setup

### Backend

```bash
cd server
npm install
```

Create `server/.env` (loaded automatically via Node's `--env-file` flag in the dev scripts):
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
SESSION_SECRET=any-long-random-string
```

Register `http://localhost:4000/api/google_callback` as an Authorized Redirect URI in your Google Cloud OAuth client (the Vite dev proxy preserves the `:4000` host, and the backend builds the redirect URI from it).

### Frontend

```bash
cd web
npm install
```

No frontend configuration is needed — Google OAuth is a server-side flow.

## Running

Start both servers in separate terminals:

```bash
# Terminal 1: Backend (port 8080)
cd server
npm run dev

# Terminal 2: Frontend (port 4000)
cd web
npm run dev
```

The Vite dev server on port 4000 proxies `/api/*` to the Express backend on port 8080.

Open `http://localhost:4000` in your browser.

### Persisted State During Development

- `server/.wwebjs_auth/` — WhatsApp sessions (keyed by the `uid` cookie); survive restarts, so you only scan the QR once
- `server/.data/persist.json` — Google refresh tokens; Google stays connected across restarts
- Both are gitignored; deleting them forces re-authentication (equivalent to a logout for that browser's `uid`)

## Available Commands

### Backend (`server/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with nodemon, env loaded from `.env` (auto-reload on `.ts`/`.js`/`.json` changes in `main.ts`, `routes/`, `src/`, `../interfaces/` — state dirs are ignored) |
| `npm run serve` | Start with env from `.env` (no auto-reload) |
| `npm run build` | Compile TypeScript to `./build` |
| `npm run prod` | Run compiled JavaScript (no `.env` auto-load — pass env via Docker `--env-file` or shell) |
| `npm test` | Run unit tests (node:test + ts-node, phone matching) |

### Frontend (`web/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server on port 4000 with HMR |
| `npm run build` | Type-check + production build to `./dist` |
| `npm run preview` | Serve production build locally |

### Docker

```bash
# Full stack
docker build -t picsync .
docker run --rm -it -p 80:80 picsync

# Frontend only
docker build -t picsync-web -f web/Dockerfile .

# Backend only
docker build -t picsync-backend -f server/Dockerfile .
```

## VS Code Configuration

The project includes VS Code launch and task configs in `.vscode/`.

### Debug Configurations

1. **Launch Backend** — Attaches Node.js debugger to `ts-node server/main.ts` (transpile-only mode)
2. **Launch Frontend** — Starts Vite dev server task, then opens Chrome debugger on port 4000

### Tasks

- `npm run dev (web)` — Background task that starts the Vite dev server

## Project Structure

```
picsync/
├── interfaces/
│   └── api.ts               # Shared types (imported by both web/ and server/)
├── server/
│   ├── main.ts               # Express entry: middleware, session, CORS, uid cookie
│   ├── routes/api.ts         # Endpoints: status, init_whatsapp, google_auth_start/callback, init_sync, check_purchase, logout
│   └── src/
│       ├── sync.ts             # Core: contact matching, photo sync, rate limiting
│       ├── whatsapp.ts         # WhatsApp Web.js client lifecycle (LocalAuth persistence)
│       ├── gapi.ts             # Google OAuth code flow + People API + token revoke
│       ├── phone.ts            # libphonenumber-js normalization + match candidates
│       ├── phone.test.ts       # Unit tests for phone matching
│       ├── persist.ts          # File store for Google refresh tokens (.data/persist.json)
│       ├── cache.ts            # LRU cache (4096 entries, 1hr sliding TTL)
│       ├── ws.ts               # WebSocket send + request/response pattern
│       ├── payments.ts         # BuyMeACoffee + Redis payment verification
│       ├── interfaces.ts       # SimpleContact type
│       └── types.ts            # Base64 type alias
├── web/
│   ├── src/
│   │   ├── main.ts            # Vue app, router, navigation guards
│   │   ├── App.vue            # Root component (WebSocket redirect handler)
│   │   ├── settings.ts        # Global enforcePayments deferred
│   │   ├── deferred.ts        # Promise wrapper utility
│   │   ├── pages/             # 7 route components
│   │   ├── components/        # AccountChips (disconnect + logout), Header, Footer
│   │   └── services/ws.ts     # WebSocket client + event pub/sub
│   ├── vite.config.ts         # Dev proxy to backend
│   └── tailwind.config.cjs    # TailwindCSS + DaisyUI + Typography
├── assets/
│   ├── nginx.conf             # Production reverse proxy config
│   └── entrypoint.sh          # Docker startup script
├── Dockerfile                 # Multi-stage full-stack build
├── web/Dockerfile             # Frontend-only build
└── server/Dockerfile          # Backend-only build
```

## TypeScript Configuration

The project uses separate TypeScript configs:

- **Server** (`server/tsconfig.json`): Target ES2015, CommonJS modules, output to `./build`
- **Web** (`web/tsconfig.json`): Target ESNext, ESM modules, strict mode, Vue support
- **Web Node** (`web/tsconfig.node.json`): Composite config for `vite.config.ts`

Both packages import from the shared `interfaces/api.ts` file for type safety across the WebSocket protocol.

## Code Patterns

### Backend Patterns

- **Session data via LRU cache** — All per-user state keyed as `{sessionID}-{key}`, sliding 1h TTL
- **Persistence via uid cookie** — On-disk state (WhatsApp LocalAuth, Google refresh token) keyed by a stable 1-year cookie, since `sessionID` regenerates on restart
- **Fire-and-forget async** — `initSync` runs asynchronously; progress reported via WebSocket
- **Per-contact error isolation** — Each contact wrapped in try/catch; one failure doesn't abort the sync
- **Rate limiting + retry** — Token bucket at 1 req/1.5s; transient Google 5xx/429 retried with backoff
- **Graceful cleanup** — 5-minute timeout before destroying the in-memory WhatsApp client on disconnect (persisted state untouched)

### Frontend Patterns

- **Backend-driven state** — No client-side store; session checked on every route change
- **Deferred promises** — `isWsReady` and `enforcePayments` resolve asynchronously
- **Event-based WebSocket** — Components register handlers for specific event types
- **Bot detection** — `isbot` library skips resource-heavy operations for crawlers
- **Dark card UI** — Custom DaisyUI theme with oklch emerald accents; utility classes only
