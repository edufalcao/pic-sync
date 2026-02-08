# CLAUDE.md

## Project

WhatsApp Contact Sync — web app that syncs WhatsApp profile pictures to Google Contacts by matching phone numbers.

## Tech Stack

- **Frontend:** Vue 3 + TypeScript, Vite, TailwindCSS 4, DaisyUI 5, Vue Router 4
- **Backend:** Node.js + Express 4 + TypeScript, whatsapp-web.js, Google People API, Puppeteer
- **Infra:** Docker (multi-stage), Nginx reverse proxy, LRU cache sessions

## Structure

```
interfaces/api.ts        — Shared types/enums (EventType, SessionStatus, SyncProgress, SyncOptions)
server/main.ts           — Express entry: middleware, session, CORS
server/routes/api.ts     — REST endpoints + WebSocket handler
server/src/sync.ts       — Core sync logic: phone matching, rate limiting, manual/auto modes
server/src/whatsapp.ts   — WhatsApp client lifecycle, QR flow, contact loading, photo download
server/src/gapi.ts       — Google OAuth, People API contact listing, photo updates
server/src/cache.ts      — LRU cache (4096 entries, 1hr TTL), key format: {sessionID}-{key}
server/src/ws.ts         — WebSocket send + request/response pattern (30s timeout)
server/src/payments.ts   — BuyMeACoffee API + Redis purchase verification
web/src/main.ts          — Vue app, router, navigation guards (enforces auth flow)
web/src/pages/           — 7 route components (Home, WhatsApp, GoogleAuth, Options, Sync, Contribute, Privacy)
web/src/services/ws.ts   — WebSocket client, event pub/sub
web/src/settings.ts      — Global enforcePayments deferred
assets/nginx.conf        — SPA routing + /api/* proxy to :8080 with WebSocket support
assets/entrypoint.sh     — Docker startup: Express first, then Nginx
```

## Commands

```bash
# Development
cd server && npm run dev     # Backend with nodemon (port 8080)
cd web && npm run dev        # Frontend with Vite HMR (port 4000, proxies /api to :8080)

# Build
cd server && npm run build   # TypeScript → ./build
cd web && npm run build      # vue-tsc check + Vite → ./dist

# Production
cd server && npm run prod    # Run compiled JS

# Docker
docker build -t whasync .    # Full stack (Nginx + Express + Chromium)
```

## Key Architecture Decisions

- **No frontend store** — Backend sessions are the source of truth; `/api/status` checked on every route change
- **WebSocket for everything real-time** — QR codes, sync progress, manual photo confirmation
- **Shared types** — `interfaces/api.ts` imported by both packages for type-safe WebSocket protocol
- **Rate limiting** — 1 photo per 1.5s (40/min) for Google People API (limit is 60/min)
- **Brazilian phone number fallback** — Handles 9th digit transition (insert/remove "9" after area code for country code 55)
- **Graceful cleanup** — 5-minute timeout before destroying WhatsApp client on WS disconnect

## Environment Variables

Required: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
Recommended: `SESSION_SECRET`, `ORIGIN`, `NODE_ENV`
Optional: `ROUTE_PREFIX`, `ENFORCE_PAYMENTS`, `COFFEE_TOKEN`, `REDIS_URL`
Auto-set in Docker: `RUNNING_IN_DOCKER`, `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD`

## Code Conventions

- TypeScript strict mode in both packages
- Server: CommonJS modules, ES2015 target
- Web: ESM modules, ESNext target
- Styling: TailwindCSS utility classes + DaisyUI components, no scoped CSS
- Error handling: try-catch with console.error logging; sync errors sent via WebSocket events
- No test suite currently in the project

## Documentation

See `docs/` for detailed documentation:
- `docs/architecture.md` — System design, data flow, design decisions
- `docs/backend.md` — Express server, modules, sync engine
- `docs/frontend.md` — Vue SPA, router guards, pages, WebSocket service
- `docs/api-reference.md` — REST endpoints, WebSocket events, shared types
- `docs/deployment.md` — Docker builds, Nginx, environment variables
- `docs/development.md` — Setup, commands, VS Code config, code patterns
