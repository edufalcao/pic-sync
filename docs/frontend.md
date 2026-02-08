# Frontend Documentation

The frontend is a Vue 3 Single Page Application built with TypeScript, Vite, TailwindCSS, and DaisyUI.

## Application Setup (`web/src/main.ts`)

### Router Configuration

Routes are defined with Vue Router 4:

| Path | Component | Purpose |
|------|-----------|---------|
| `/` | `Home.vue` | Landing page |
| `/privacy` | `Privacy.vue` | Privacy policy (required by Google OAuth) |
| `/contribute` | `Contribute.vue` | Payment verification gate |
| `/whatsapp` | `WhatsApp.vue` | QR code authentication |
| `/gauth` | `GoogleAuth.vue` | Google OAuth consent |
| `/options` | `Options.vue` | Sync configuration |
| `/sync` | `Sync.vue` | Live sync progress |

### Navigation Guards

A `router.beforeEach` guard runs on every navigation, enforcing the auth flow:

1. Allow `/` and bots unconditionally
2. Fetch `/api/status` to get current session state
3. **Payment flow** (if `enforcePayments` is true):
   - Unpurchased users → redirect to `/contribute`
   - Purchased users → skip `/contribute`
4. **Auth flow enforcement:**
   - `/sync`, `/gauth`, `/options` require WhatsApp connected → else redirect to `/`
   - `/sync` requires Google connected → else redirect to `/gauth`
   - If WhatsApp already connected on `/whatsapp` → skip to `/gauth`
   - If Google already connected on `/gauth` → skip to `/options`

### State Management

There is **no Vuex/Pinia store**. State flows through:

1. **Backend sessions** — The source of truth. Checked via `/api/status` on each route change.
2. **Component local state** — Each page manages its own reactive data.
3. **Query parameters** — Options page passes `manual_sync` and `overwrite_photos` to sync page.
4. **Global deferred** — `enforcePayments` in `settings.ts` resolves once on first route check.
5. **WebSocket events** — Real-time updates pushed from server to component handlers.

### Google Analytics

Integrated via `vue-gtag`. Tracks:
- Page views (automatic via router)
- `host_*` event on landing
- `google_authorized` on OAuth completion
- `num_contacts_synced` with contact count
- Payment-related events

## Pages

### Home (`web/src/pages/Home.vue`)

Landing page with a "Get Started" button.

- Waits for WebSocket readiness before enabling the button
- Fetches `SessionStatus` to show "Continue" instead of "Get Started" if session exists
- Bot detection skips WebSocket check for crawlers

### WhatsApp (`web/src/pages/WhatsApp.vue`)

Displays a QR code for WhatsApp authentication.

- Registers handlers for `WhatsAppQR` and `WhatsAppConnecting` events
- Skips QR loading for bots (saves server resources)
- Shows a loading spinner overlay when connection is in progress
- QR code rendered via `qrcode.vue` component with custom styling

### GoogleAuth (`web/src/pages/GoogleAuth.vue`)

Handles Google OAuth 2.0 using two external libraries:
- **Google Identity Services (GIS)** — Token acquisition and consent UI
- **Google API Client (GAPI)** — API initialization with People API discovery doc

**Flow:**
1. Both libraries load asynchronously (appended to `<head>`)
2. GIS initializes a token client with `contacts` scope
3. User clicks "Sign in with Google" → OAuth consent dialog
4. On success: token sent to `POST /api/init_gapi`
5. Server responds with redirect path → router navigates

**Credentials** (public OAuth client keys, safe to expose):
- `CLIENT_ID` and `API_KEY` are hardcoded constants in the component

### Options (`web/src/pages/Options.vue`)

Presents two sync configuration options:

1. **Manual Sync** — Compare photos side-by-side before syncing
2. **Overwrite existing images** — Replace photos that already exist

Options are mutually exclusive (checking one unchecks the other). On "Start Sync", the selected values are passed as query parameters to `/sync`.

### Sync (`web/src/pages/Sync.vue`)

The most complex page. Displays real-time sync progress.

**Features:**
- Progress bar (0-100%)
- Avatar group showing last 9 synced contact photos
- "+N more" badge for additional synced contacts
- Server disconnect detection (30-second timeout, checked every 5s)
- Error alert display

**Manual sync mode:**
- Shows side-by-side photo comparison (existing Google photo vs. new WhatsApp photo)
- User accepts or rejects each photo
- Decision sent via `SyncPhotoConfirm` WebSocket event

**Events handled:**
- `SyncProgress` — Updates progress bar, images, and count
- `SyncConfirm` — Triggers manual photo comparison UI

### Contribute (`web/src/pages/Contribute.vue`)

Payment verification page (only shown when `enforcePayments` is true).

- User enters email used for BuyMeACoffee purchase
- Sends `POST /api/check_purchase` with email
- On success: redirects to `/whatsapp`
- Shows errors for failed verification or multi-device attempts

### Privacy (`web/src/pages/Privacy.vue`)

Static privacy policy page required by Google OAuth publishing requirements.

## Components

### Header (`web/src/components/Header.vue`)

- App logo and title with link to home
- GitHub star button (iframe)
- DaisyUI `navbar` component

### Footer (`web/src/components/Footer.vue`)

- Step indicator showing progress through the auth flow
- Steps: Contribute (conditional) → WhatsApp → Google → Options → Sync
- Current step highlighted with `primary` color
- Privacy policy and GitHub links

## WebSocket Service (`web/src/services/ws.ts`)

Event-based pub/sub system for server communication.

### Initialization

`initWs()`:
1. Makes a dummy `fetch("/api/")` to establish the session cookie
2. Creates WebSocket to `{ws|wss}://{host}/api/ws`
3. On error: logs and retries after 3 seconds
4. On open: resolves `isWsReady` deferred promise

### API

| Function | Description |
|----------|-------------|
| `initWs()` | Initialize WebSocket connection |
| `addHandler(eventType, func)` | Register handler for an event type |
| `sendEvent(eventType, data?)` | Send JSON event to server |
| `isWsReady` | Deferred promise, resolves when WS opens |
| `WS` | Global WebSocket instance |

### Message Handling

Incoming messages are parsed as `{ type, data }`. The handler registered for `type` is called with `data`. If no handler is found, an error is logged.

## Styling

### TailwindCSS + DaisyUI

- TailwindCSS 4 with `@tailwindcss/typography` plugin
- DaisyUI 5 for pre-built components
- Default light theme (no custom theme configuration)
- No scoped CSS in components — all utility classes

### DaisyUI Components Used

`navbar`, `hero`, `btn`, `form-control`, `toggle`, `alert`, `progress`, `avatar`, `avatar-group`, `badge`, `loading`, `steps`, `tooltip`, `footer`

### Custom CSS (`web/src/style.css`)

Minimal overrides:
- `#app` — full width/height, centered text
- `.qr-code` — white border with rounded corners
- `.center-spinner` — auto margin for centering

## Build Configuration

### Vite (`web/vite.config.ts`)

- Vue 3 plugin enabled
- Dev server proxy: `/api/*` → `http://localhost:8080` (strips `/api` prefix)
- WebSocket proxy: `/api/ws` → `ws://localhost:8080/ws`

### TypeScript (`web/tsconfig.json`)

- Target: ESNext (Vite handles transpilation)
- Strict mode enabled
- Vue file support via `vue-tsc`
- Custom type stubs in `./typing-stubs/`

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server on port 4000 |
| `npm run build` | Type-check (`vue-tsc`) then Vite production build |
| `npm run preview` | Serve production build locally |
