// Google sign-in (Google Identity Services, token client). The token lives in memory only:
// it is never stored, logged or put into a URL. It lasts about an hour; when it runs out,
// the user taps "Belépés" again (a pop-up can only be opened from a tap).

import { DriveError } from "./drive.js";

const SAFETY_MS = 60_000; // treat the token as expired a minute early

export function createAuth({ clientId, scope }) {
  let token = "";
  let expiresAt = 0;

  function valid() {
    return Boolean(token) && Date.now() < expiresAt - SAFETY_MS;
  }

  return {
    signedIn: valid,

    /** For the Drive calls: the token, or a DriveError that asks for a sign-in. */
    async getToken() {
      if (!valid()) {
        throw new DriveError("A feltöltéshez lépj be az iskolai Google-fiókoddal.", { auth: true });
      }
      return token;
    },

    forget() {
      token = "";
      expiresAt = 0;
    },

    /** Must be called from a tap. Resolves when signed in; rejects with a Hungarian message. */
    signIn() {
      return new Promise((resolve, reject) => {
        const gis = globalThis.google?.accounts?.oauth2;
        if (!gis) {
          reject(new Error("A Google-belépés nem töltődött be. Van internet? Töltsd újra az oldalt."));
          return;
        }
        const client = gis.initTokenClient({
          client_id: clientId,
          scope,
          callback: (answer) => {
            if (answer.error || !answer.access_token) {
              reject(new Error("A belépés nem sikerült. Az iskolai fiókodat válaszd."));
              return;
            }
            token = answer.access_token;
            expiresAt = Date.now() + Number(answer.expires_in ?? 0) * 1000;
            resolve();
          },
          error_callback: () => reject(new Error("A belépés megszakadt. Próbáld újra.")),
        });
        client.requestAccessToken({ prompt: "" });
      });
    },
  };
}
