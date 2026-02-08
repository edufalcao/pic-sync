# Deployment Guide

## Docker Builds

The project provides three Dockerfile options for different deployment strategies.

### Full Stack (Root `Dockerfile`)

Single container running both the Vue frontend (via Nginx) and Express backend.

```bash
docker build -t whasync .
docker run --rm -it -p 80:80 whasync
```

**Multi-stage build:**

1. **web-build** (Node 21 Alpine) — Installs frontend deps, builds Vue app with Vite
2. **server-build** (Node 21 Alpine) — Installs backend deps, compiles TypeScript, prunes production deps, runs `node-prune`
3. **Final** (Node 21 Alpine) — Installs Chromium + Nginx, copies built assets from both stages

**Runtime architecture:**
- Nginx serves static files from `/var/www/html` on port 80
- Nginx proxies `/api/*` to Express on `localhost:8080`
- `entrypoint.sh` starts Express first, waits for port 8080, then starts Nginx

### Frontend Only (`web/Dockerfile`)

Standalone Nginx container serving the Vue SPA.

```bash
docker build -t whasync-web -f web/Dockerfile .
```

Requires a separate backend instance. The frontend expects `/api/*` to be proxied to the backend.

### Backend Only (`server/Dockerfile`)

Standalone Node.js container with Chromium.

```bash
docker build -t whasync-backend -f server/Dockerfile .
```

Exposes port 8080 directly (no Nginx). Includes Chromium for WhatsApp Web.js.

## Nginx Configuration (`assets/nginx.conf`)

Key features:

- **Daemon off** — Container-friendly (process stays in foreground)
- **SPA routing** — `try_files $uri $uri/ /index.html` for client-side routing
- **API reverse proxy** — `/api/` → `http://127.0.0.1:8080/` with WebSocket upgrade support
- **Gzip** enabled
- **Logging** to stdout/stderr for Docker log collection
- **WebSocket headers** — `Upgrade` and `Connection` headers passed through

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    # ... additional proxy headers
}
```

## Docker Entrypoint (`assets/entrypoint.sh`)

```bash
#!/bin/sh
node build/server/main.js &         # Start backend
while ! nc -z 0.0.0.0 8080; do      # Wait for backend
  sleep 0.1
done
nginx &                               # Start Nginx
wait %1                               # Exit if backend crashes
```

The `wait %1` ensures the container exits if the Node.js process crashes.

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |

### Recommended

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_SECRET` | `"secret"` | Session cookie signing key (change in production) |
| `ORIGIN` | `http://localhost:8080` | CORS allowed origin |
| `NODE_ENV` | — | Set to `"production"` for secure cookies and proxy trust |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTE_PREFIX` | `""` | Prefix for all API routes |
| `ENFORCE_PAYMENTS` | `"false"` | Enable payment gate |
| `COFFEE_TOKEN` | — | BuyMeACoffee API bearer token |
| `REDIS_URL` | `redis://localhost:6379` | Redis URL for payment data persistence |

### Set Automatically

| Variable | Value | Set By |
|----------|-------|--------|
| `RUNNING_IN_DOCKER` | `"true"` | Dockerfile |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `"true"` | Dockerfile (Chromium installed via apk) |

## Frontend Configuration

The Google OAuth credentials in the frontend (`web/src/pages/GoogleAuth.vue`) are hardcoded constants:

- `CLIENT_ID` — Google OAuth client ID (public, safe to expose)
- `API_KEY` — Google API browser key (public, safe to expose)

To use your own Google project, update these values and ensure your Google Cloud project has the People API enabled with the correct OAuth redirect URIs.

## Production Considerations

### Session Security
- Set `SESSION_SECRET` to a strong random value
- Set `NODE_ENV=production` to enable secure (HTTPS-only) cookies
- Set `ORIGIN` to your actual domain

### Resource Usage
- Each active WhatsApp session runs a headless Chromium instance
- LRU cache is limited to 4096 sessions (tune `max` in `cache.ts` if needed)
- WhatsApp clients are destroyed 5 minutes after WebSocket disconnect

### Scaling Limitations
- Sessions are stored in-memory (not shared across instances)
- WhatsApp clients are process-bound (cannot be distributed)
- Single-instance deployment is the intended architecture

### CI/CD

Dependabot is configured (`.github/dependabot.yml`) to check daily for `whatsapp-web.js` updates in the server package only.
