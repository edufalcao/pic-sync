import crypto from "crypto";
import express from "express";
import { Request, Response } from "express";
import WebSocket from "ws";
// @ts-ignore
import patch from "express-ws/lib/add-ws-method";

import { WAState } from "whatsapp-web.js";

import { SessionStatus, SyncOptions } from "../../interfaces/api";
import { initWhatsApp, deleteWhatsAppAuth } from "../src/whatsapp";
import { initSync } from "../src/sync";
import {
  generateGoogleAuthUrl,
  getOAuth2ClientFromCode,
  getOAuth2ClientFromStorage,
  revokeGoogleAccess,
} from "../src/gapi";
import { deleteFromCache, getFromCache, setInCache } from "../src/cache";
import { enforcePayments } from "../main";
import { checkPurchase } from "../src/payments";

// Based on https://github.com/HenningM/express-ws/issues/86
const router = express.Router({ mergeParams: true });
patch(router);

function cleanup(sessionID: string) {
  /*
    Cleanup the session and client objects.
    This is done with a timeout to prevent cleanup on websocket disconnect
      and re-connect (for example, during a page refresh).
  */
  const timeout = setTimeout(async () => {
    if (getFromCache(sessionID, "whatsapp") !== undefined) {
      try {
        const client = getFromCache(sessionID, "whatsapp");
        deleteFromCache(sessionID, "whatsapp");
        client.destroy();
      } catch (e) {}
    }

    deleteFromCache(sessionID, "gauth");
    deleteFromCache(sessionID, "ws");
  }, 5 * 60 * 1000); // 5 minutes.

  setInCache(sessionID, "cleanup", timeout);
}

router.get("/", (req: Request, res: Response) => {
  res.send("{}");
});

router.ws("/ws", (ws: WebSocket, req: Request) => {
  if (getFromCache(req.sessionID, "cleanup") !== undefined) {
    clearTimeout(getFromCache(req.sessionID, "cleanup"));
    deleteFromCache(req.sessionID, "cleanup");
  }

  ws.addEventListener("close", () => cleanup(req.sessionID));
  setInCache(req.sessionID, "ws", ws);
});

// Used by route guard
router.get("/status", async (req: Request, res: Response) => {
  const uid: string = (req as any).uid;

  let whatsappConnected = false;
  try {
    whatsappConnected =
      (await getFromCache(req.sessionID, "whatsapp")?.getState()) ===
      WAState.CONNECTED;
  } catch {}

  /*
    Google: use the cached client if present; on a miss (restart, TTL, new
    process) silently rebuild it from the refresh token persisted on disk, so
    users stay connected across server restarts without re-consenting.
  */
  let gAuth = getFromCache(req.sessionID, "gauth");
  if (!gAuth) {
    gAuth = getOAuth2ClientFromStorage(uid);
    if (gAuth) setInCache(req.sessionID, "gauth", gAuth);
  }

  const status: SessionStatus = {
    whatsappConnected,
    googleConnected: gAuth !== undefined && gAuth !== null,
    enforcePayments,
    purchased: enforcePayments
      ? getFromCache(req.sessionID, "purchased")
      : true,
  };

  res.send(status);
});

router.get("/init_whatsapp", async (req: Request, res: Response) => {
  const uid: string = (req as any).uid;
  if (getFromCache(req.sessionID, "whatsapp") !== undefined)
    try {
      const client = getFromCache(req.sessionID, "whatsapp");
      deleteFromCache(req.sessionID, "whatsapp");
      client.destroy();
    } catch (e) {}

  const client = initWhatsApp(req.sessionID, uid);
  setInCache(req.sessionID, "whatsapp", client);
  res.send("{}");
});

router.get("/google_auth_start", (req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString("hex");
  setInCache(req.sessionID, "oauth_state", state);
  const redirectUri = `${req.protocol}://${req.get("host")}/api/google_callback`;
  const authUrl = generateGoogleAuthUrl(redirectUri, state);
  res.redirect(authUrl);
});

router.get("/google_callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect("/?error=google_auth_denied");
  }

  const storedState = getFromCache(req.sessionID, "oauth_state");
  if (!state || state !== storedState) {
    return res.redirect("/?error=invalid_state");
  }
  deleteFromCache(req.sessionID, "oauth_state");

  const redirectUri = `${req.protocol}://${req.get("host")}/api/google_callback`;
  try {
    const gAuth = await getOAuth2ClientFromCode(
      (req as any).uid,
      code as string,
      redirectUri
    );
    setInCache(req.sessionID, "gauth", gAuth);
    res.redirect("/options");
  } catch (e) {
    res.redirect("/?error=google_token_exchange_failed");
  }
});

router.get("/init_sync", (req: Request, res: Response) => {
  initSync(req.sessionID, req.query as SyncOptions);
  res.send("{}");
});

router.post("/check_purchase", async (req: Request, res: Response) => {
  const email = req.body.email;
  const purchased = await checkPurchase(email);
  setInCache(req.sessionID, "purchased", purchased);
  setInCache(req.sessionID, "email", email);
  res.send({ purchased });
});

/*
  Disconnect one or both accounts: `scope` = "whatsapp" | "google" | "all".
  This is the ONLY path that deletes persisted state — the WS cleanup timer
  and cache expiry only ever drop the in-memory copies.
*/
router.post("/logout", async (req: Request, res: Response) => {
  const uid: string = (req as any).uid;
  const scope: string = req.body?.scope || "all";

  // Cancel any pending WS cleanup so it can't race with the teardown below.
  const pendingCleanup = getFromCache(req.sessionID, "cleanup");
  if (pendingCleanup !== undefined) {
    clearTimeout(pendingCleanup);
    deleteFromCache(req.sessionID, "cleanup");
  }

  if (scope === "whatsapp" || scope === "all") {
    const client = getFromCache(req.sessionID, "whatsapp");
    deleteFromCache(req.sessionID, "whatsapp");
    if (client !== undefined) {
      try {
        await client.destroy();
      } catch (e) {}
    }
    // Remove the on-disk WhatsApp session so the next connect requires a
    // fresh QR scan (otherwise LocalAuth would silently restore the account).
    deleteWhatsAppAuth(uid);
  }

  if (scope === "google" || scope === "all") {
    await revokeGoogleAccess(uid);
    deleteFromCache(req.sessionID, "gauth");
  }

  // The session (and every cache key) is about to be rotated. Remember the
  // state that survives this logout so it can be re-keyed to the new
  // session ID afterwards — otherwise a google-only logout would orphan the
  // still-connected WhatsApp client and force a needless re-scan.
  const oldSessionID = req.sessionID;
  const keptWhatsapp =
    scope === "google" ? getFromCache(oldSessionID, "whatsapp") : undefined;
  const keptPurchased = getFromCache(oldSessionID, "purchased");
  const keptEmail = getFromCache(oldSessionID, "email");

  // Drop the websocket and remaining session-bound entries.
  const ws = getFromCache(oldSessionID, "ws");
  deleteFromCache(oldSessionID, "ws");
  deleteFromCache(oldSessionID, "whatsapp");
  deleteFromCache(oldSessionID, "gauth");
  deleteFromCache(oldSessionID, "purchased");
  deleteFromCache(oldSessionID, "email");
  if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  // Rotate the session ID so nothing from the old session carries over,
  // then carry the surviving state over to the new one.
  req.session.regenerate((err) => {
    if (err) console.error("Failed to regenerate session on logout:", err);
    if (keptWhatsapp !== undefined) {
      setInCache(req.sessionID, "whatsapp", keptWhatsapp);
    }
    if (keptPurchased !== undefined) {
      setInCache(req.sessionID, "purchased", keptPurchased);
    }
    if (keptEmail !== undefined) {
      setInCache(req.sessionID, "email", keptEmail);
    }
    res.send("{}");
  });
});

export default router;
