import { google, Auth, people_v1 } from "googleapis";

import { SimpleContact } from "./interfaces";
import { Base64 } from "./types";
import { deleteGoogleRefreshToken, getGoogleRefreshToken, setGoogleRefreshToken } from "./persist";

const pageSize: number = 250;

export function generateGoogleAuthUrl(
  redirectUri: string,
  state: string
): string {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: "https://www.googleapis.com/auth/contacts",
    state,
    prompt: "consent",
  });
}

export async function getOAuth2ClientFromCode(
  uid: string,
  code: string,
  redirectUri: string
): Promise<Auth.OAuth2Client> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Persist the refresh token so the Google connection survives restarts and
  // cache expiry without repeating the consent flow.
  if (tokens.refresh_token) {
    setGoogleRefreshToken(uid, tokens.refresh_token);
  }

  return oauth2Client;
}

/*
  Rebuild an authorized client from the refresh token persisted on disk.
  Returns null when nothing is stored for this uid (e.g. fresh browser or
  after logout).
*/
export function getOAuth2ClientFromStorage(uid: string): Auth.OAuth2Client | null {
  const refreshToken = getGoogleRefreshToken(uid);
  if (!refreshToken) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

/*
  Revoke the grant at Google (so it disappears from the account's
  "Third-party apps with access" page) and drop the stored token.
*/
export async function revokeGoogleAccess(uid: string): Promise<void> {
  const refreshToken = getGoogleRefreshToken(uid);
  deleteGoogleRefreshToken(uid);
  if (!refreshToken) return;

  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
  } catch (e) {
    console.error("Failed to revoke Google token:", e);
  }
}

export async function listContacts(
  auth: Auth.OAuth2Client
): Promise<SimpleContact[]> {
  const people: people_v1.People = google.people({ version: "v1", auth });

  let simpleContacts: SimpleContact[] = [];
  let nextPageToken = "";

  do {
    const res = await people.people.connections.list({
      resourceName: "people/me",
      pageSize: pageSize,
      personFields: "names,emailAddresses,phoneNumbers,photos",
      pageToken: nextPageToken,
    });

    nextPageToken = res.data.nextPageToken!;
    const connections = res.data.connections;

    const contacts = connections!
      .filter((connection) => connection.phoneNumbers)
      .map(
        (connection) =>
          <SimpleContact>{
            id: connection.resourceName,
            name: connection.names?.find((name) => name.displayName)?.displayName,
            // Keep the E.164 `canonicalForm` when Google could parse the number,
            // otherwise fall back to the raw `value` so numbers saved in a local
            // format (no +CC) are normalized later against the user's region
            // instead of being silently dropped.
            numbers: connection
              .phoneNumbers!.map(
                (phoneNumber) => phoneNumber.canonicalForm ?? phoneNumber.value
              )
              .filter((number): number is string => Boolean(number)),
            hasPhoto: !connection.photos // Check if photos contain only the "default" photo
              ?.map((photo) => photo.default)
              .every((v) => v === true),
            photoUrl: connection.photos?.find((photo) => photo.metadata?.primary)?.url,
          }
      );

    simpleContacts = simpleContacts.concat(contacts);
  } while (nextPageToken);

  return simpleContacts;
}

export async function updateContactPhoto(
  auth: Auth.OAuth2Client,
  resourceName: string,
  photo: Base64
): Promise<void> {
  const people: people_v1.People = google.people({ version: "v1", auth });

  // Google occasionally returns transient 5xx under sustained write load.
  // Retry those (and rate-limit errors) with linear backoff instead of
  // silently skipping the contact.
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await people.people.updateContactPhoto({
        resourceName: resourceName,
        requestBody: { photoBytes: photo },
      });
      return;
    } catch (e: any) {
      const status: number | undefined = e?.response?.status ?? e?.code;
      const retryable =
        status === undefined || status === 429 || (status >= 500 && status <= 599);
      if (!retryable || attempt === maxAttempts) {
        throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}
