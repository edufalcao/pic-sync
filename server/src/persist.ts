import fs from "fs";
import path from "path";

/*
  File-based persistence keyed by the browser's `uid` cookie.

  The in-memory session cache dies on every server restart; this store keeps
  the long-lived bits on disk so a restart doesn't force re-authorization:
    - `googleRefreshToken` — lets us silently rebuild the Google OAuth client.
  Intentionally file-based rather than Redis: this is a private, single-node
  self-hosted app and Redis is only wired up when ENFORCE_PAYMENTS is enabled.
*/

// Anchor to the process working directory (server/) rather than __dirname,
// which points inside build/ for the compiled output and gets wiped on rebuild.
const dataDir = path.join(process.cwd(), ".data");
const storePath = path.join(dataDir, "persist.json");

interface PersistedState {
  [uid: string]: {
    googleRefreshToken?: string;
  };
}

function readStore(): PersistedState {
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(state: PersistedState): void {
  fs.mkdirSync(dataDir, { recursive: true });
  // Write to a temp file then rename, so a crash mid-write can't corrupt the store.
  const tmpPath = `${storePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, storePath);
}

export function getGoogleRefreshToken(uid: string): string | undefined {
  return readStore()[uid]?.googleRefreshToken;
}

export function setGoogleRefreshToken(uid: string, token: string): void {
  const state = readStore();
  state[uid] = { ...state[uid], googleRefreshToken: token };
  writeStore(state);
}

export function deleteGoogleRefreshToken(uid: string): void {
  const state = readStore();
  delete state[uid];
  writeStore(state);
}
