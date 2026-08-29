# PicSync

<p align="center">
    <img src="web/public/logo.png" alt="logo" width="150"/>
</p>

A web app for syncing profile pictures from WhatsApp to Google Contacts.\
Matches contacts by phone number using [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) and [Google People API](https://developers.google.com/people).

## Acknowledgments

This project is a fork of [WhatsApp Contact Sync](https://github.com/guyzyl/whatsapp-contact-sync) by [Guy Zylberberg](https://github.com/guyzyl) and renamed to PicSync. The original idea and core implementation belong to the original author. It is not intended for commercial use and will never be distributed.

## How To Use

1. Press "Get Started"
2. Scan the QR code with WhatsApp to authorize it
3. Connect your Google account
4. Choose your sync options
5. That's it!

The whole process takes about 2 minutes. Syncing runs at ~1 photo every 1.5 seconds (due to Google API rate limits). You can disconnect either account at any time using the account chips on the options/sync pages.

## How to Run Locally

In order for the backend to function, it requires an OAuth 2.0 client ID and secret.\
Since (for obvious reasons) this is a private app, you will need to create one for your own.\
You can see instructions on how to do that [here](https://developers.google.com/workspace/guides/create-credentials).\
Once you do that, create the file `server/.env`, and set the following environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET` (recommended — any long random string; defaults to a hardcoded value)

You also need to add the **Authorized Redirect URI** matching your setup to your OAuth 2.0 client in the [Google Cloud Console](https://console.cloud.google.com):

- Local dev (Vite on :4000): `http://localhost:4000/api/google_callback`
- Docker (port 80): `http://localhost/api/google_callback`
- Production: `https://<your-domain>/api/google_callback`

Once that's done, you can go ahead and run the app:

```bash
# Run backend
cd server
npm install
npm run dev

# Run web app
cd web
npm install
npm run dev

# Run backend tests
cd server
npm test
```

Once connected, both accounts stay authorized across restarts: the WhatsApp session is persisted on disk (`.wwebjs_auth`) and the Google refresh token in `.data/`, so no QR rescan or re-consent is needed unless you explicitly disconnect.

## Build Docker Images

There are 3 different `Dockerfile`s for this app:

- [`Dockerfile`](Dockerfile) - This is an image containing both the backend and the web app
- [`Dockerfile`](web/Dockerfile) - An image containing only the web app
- [`Dockerfile`](server/Dockerfile) - An image containing only the backend

In order to build and run the complete app, you need to run the following commands:

```bash
docker build -t picsync .
docker run --rm -it -p 80:80 --env-file server/.env picsync
```

To keep WhatsApp sessions and Google authorizations across container restarts, mount a volume for the persisted state:

```bash
docker run --rm -it -p 80:80 --env-file server/.env -v picsync-data:/app/server/.data -v picsync-wa:/app/server/.wwebjs_auth picsync
```

In order to build the separate images for the backend and frontend, execute the following commands from the project's main directory:

```bash
docker build -t picsync-backend --env-file server/.env -f server/Dockerfile .
docker build -t picsync-web -f web/Dockerfile .
```
