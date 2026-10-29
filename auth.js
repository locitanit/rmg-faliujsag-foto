// Google sign-in (Google Identity Services, token client). The token lives in memory only:
// it is never stored, logged or put into a URL. It lasts about an hour; when it runs out,
// the user taps "Belépés" again (a pop-up can only be opened from a tap).

import { DriveError } from "./drive.js";

const SAFETY_MS = 60_000; // treat the token as expired a minute early
const GIS_URL = "https://accounts.google.com/gsi/client";
const GIS_WAIT_MS = 10_000;

/** Google's sign-in script, loaded once more (index.html loads it too, but an iPhone
 * home-screen app may open without it – e.g. when it was started offline). */
export function loadGis(doc = globalThis.document, waitMs = GIS_WAIT_MS) {
  return new Promise((resolve) => {
    if (globalThis.google?.accounts?.oauth2) return resolve(true);
    if (!doc) return resolve(false);
    const script = doc.createElement("script");
    const timer = setTimeout(() => resolve(false), waitMs);
    script.src = GIS_URL;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      resolve(Boolean(globalThis.google?.accounts?.oauth2));
    };
    script.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    doc.head.append(script);
  });
}

/** The message when the script cannot be had. An iPhone home-screen app gets a way out. */
export function notLoadedMessage(homeScreenApp) {
  return homeScreenApp
    ? "A Google-belépés nem töltődött be. Van internet? Ha igen, nyisd meg a fotózót Safariban " +
        "(locitanit.github.io/rmg-faliujsag-foto) – ott magától belép."
    : "A Google-belépés nem töltődött be. Van internet? Töltsd újra az oldalt.";
}

/**
 * hostedDomain: the school's Google domain – the account chooser then only offers accounts
 *   of that domain (optional).
 * getHint: gives the e-mail address to sign in with (remembered on this phone only). With
 *   it Google skips the chooser and takes exactly that account – a phone with a private
 *   and a school account no longer signs in with the wrong one.
 */
export function createAuth({
  clientId,
  scope,
  hostedDomain = "",
  getHint = () => "",
  load = loadGis,
  homeScreenApp = Boolean(globalThis.navigator?.standalone),
}) {
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
    async signIn() {
      if (!globalThis.google?.accounts?.oauth2 && !(await load())) {
        throw new Error(notLoadedMessage(homeScreenApp));
      }
      return new Promise((resolve, reject) => {
        const gis = globalThis.google.accounts.oauth2;
        const hint = getHint();
        const client = gis.initTokenClient({
          client_id: clientId,
          scope,
          ...(hint ? { login_hint: hint } : {}),
          ...(hostedDomain ? { hd: hostedDomain } : {}),
          callback: (answer) => {
            if (answer.error || !answer.access_token) {
              reject(
                new Error(
                  "A belépés nem sikerült. Az iskolai fiókodat válaszd – ha a telefon másik fiókot kínál, írd be fent az iskolai e-mail címedet.",
                ),
              );
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
