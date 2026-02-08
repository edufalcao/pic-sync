# Development Guide

## Prerequisites

- Node.js 21+
- Chromium/Chrome (auto-detected by Puppeteer locally)
- Google Cloud project with People API enabled
- Google OAuth 2.0 credentials (client ID + client secret)

## Setup

### Backend

```bash
cd server
npm install
```

Create `server/.env`:
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
SESSION_SECRET=your-secret
ORIGIN=http://localhost:4000
```

### Frontend

```bash
cd web
npm install
```

The frontend fetches Google credentials from the backend via `GET /api/config`, so no frontend changes are needed.

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

## Available Commands

### Backend (`server/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with nodemon + ts-node (auto-reload) |
| `npm run serve` | Start with ts-node (no auto-reload) |
| `npm run build` | Compile TypeScript to `./build` |
| `npm run prod` | Run compiled JavaScript |

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
│   ├── main.ts               # Express entry: middleware, session, CORS
│   ├── routes/api.ts          # Endpoints: status, init_whatsapp, init_gapi, init_sync, check_purchase
│   └── src/
│       ├── sync.ts            # Core: contact matching, photo sync, rate limiting
│       ├── whatsapp.ts        # WhatsApp Web.js client lifecycle
│       ├── gapi.ts            # Google People API: list contacts, update photos
│       ├── cache.ts           # LRU cache (4096 entries, 1hr TTL)
│       ├── ws.ts              # WebSocket send + request/response pattern
│       ├── payments.ts        # BuyMeACoffee + Redis payment verification
│       ├── interfaces.ts      # SimpleContact type
│       └── types.ts           # Base64 type alias
├── web/
│   ├── src/
│   │   ├── main.ts            # Vue app, router, navigation guards
│   │   ├── App.vue            # Root component (WebSocket redirect handler)
│   │   ├── settings.ts        # Global enforcePayments deferred
│   │   ├── deferred.ts        # Promise wrapper utility
│   │   ├── pages/             # 7 route components
│   │   ├── components/        # Header, Footer
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

- **Session data via LRU cache** — All per-user state keyed as `{sessionID}-{key}`
- **Fire-and-forget async** — `initSync` runs asynchronously; progress reported via WebSocket
- **Rate limiting** — Token bucket at 1 req/1.5s for Google API calls
- **Graceful cleanup** — 5-minute timeout before destroying WhatsApp client on disconnect
- **Silent error handling** — Photo update failures are logged but don't break the sync loop

### Frontend Patterns

- **Backend-driven state** — No client-side store; session checked on every route change
- **Deferred promises** — `isWsReady` and `enforcePayments` resolve asynchronously
- **Event-based WebSocket** — Components register handlers for specific event types
- **Bot detection** — `isbot` library skips resource-heavy operations for crawlers
- **DaisyUI components** — Consistent UI via pre-built TailwindCSS component classes
