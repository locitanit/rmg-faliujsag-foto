// Google sign-in without a pop-up: the page itself goes to Google and comes straight back
// (the OAuth "implicit" flow with a redirect). A pop-up may only be opened from a tap; a
// redirect needs no tap – so once somebody has signed in on this phone, opening the app
// signs them in again by itself (`prompt=none`: Google answers at once, without showing
// anything, as long as the account is still signed in to the browser).
//
// What is kept where:
//   - the access token: in memory + sessionStorage (this tab only, about an hour);
//   - "somebody signed in here once": localStorage – without it nobody is ever sent to
//     Google unasked; "Kijelentkezés" removes it;
//   - nothing else. No refresh token exists in a browser-only app.
//
// The token comes back in the address' #fragment (never sent to a server); it is taken out
// of the address bar before anything else happens.

import { DriveError } from "./drive.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SAFETY_MS = 60_000; // treat the token as expired a minute early
const KEY = {
  token: "faliujsag-foto.token",
  state: "faliujsag-foto.oauth-state",
  tried: "faliujsag-foto.silent-tried",
  once: "faliujsag-foto.signed-in-once",
};

export function authUrl({ clientId, scope, redirectUri, state, hint, hostedDomain, silent }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "token",
    scope,
    state,
  });
  if (silent) params.set("prompt", "none");
  else if (!hint) params.set("prompt", "select_account");
  if (hint) params.set("login_hint", hint);
  if (hostedDomain) params.set("hd", hostedDomain);
  return `${AUTH_URL}?${params}`;
}

/** What Google sent back in the #fragment – null if the fragment is not an answer. */
export function parseReturn(hash) {
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.slice(1));
  if (!params.has("access_token") && !params.has("error")) return null;
  return {
    token: params.get("access_token") ?? "",
    expiresIn: Number(params.get("expires_in") ?? 0),
    state: params.get("state") ?? "",
    error: params.get("error") ?? "",
  };
}

/** The address Google must send the answer to: this page, without `index.html`. */
export function redirectUriOf(location) {
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Storage that may be switched off (private mode): then it simply remembers nothing. */
function safe(storage) {
  return {
    get(key) {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage.setItem(key, value);
      } catch {
        // not remembered
      }
    },
    remove(key) {
      try {
        storage.removeItem(key);
      } catch {
        // nothing to remove
      }
    },
  };
}

export function createRedirectAuth({
  clientId,
  scope,
  hostedDomain = "",
  getHint = () => "",
  session = globalThis.sessionStorage,
  local = globalThis.localStorage,
  location = globalThis.location,
  history = globalThis.history,
  now = () => Date.now(),
  makeState = randomState,
}) {
  const tab = safe(session);
  const device = safe(local);
  let token = "";
  let expiresAt = 0;

  const valid = () => Boolean(token) && now() < expiresAt - SAFETY_MS;

  function go(silent) {
    const state = makeState();
    tab.set(KEY.state, state);
    location.assign(
      authUrl({
        clientId,
        scope,
        redirectUri: redirectUriOf(location),
        state,
        hint: getHint(),
        hostedDomain,
        silent,
      }),
    );
  }

  return {
    signedIn: valid,

    async getToken() {
      if (!valid()) {
        throw new DriveError("A feltöltéshez lépj be az iskolai Google-fiókoddal.", { auth: true });
      }
      return token;
    },

    /**
     * Call once when the page loads. Returns "signed-in", "refused" (Google would not sign
     * in without asking – show the button) or "none".
     */
    restore() {
      const answer = parseReturn(location.hash);
      if (answer) {
        // First of all: the token must not stay in the address bar or the history.
        history.replaceState(null, "", location.pathname + location.search);
        const expected = tab.get(KEY.state);
        tab.remove(KEY.state);
        if (!expected || answer.state !== expected) return "none"; // not an answer to our question
        if (answer.error || !answer.token) return "refused"; // "tried" stays: no second try
        token = answer.token;
        expiresAt = now() + answer.expiresIn * 1000;
        tab.set(KEY.token, JSON.stringify({ token, expiresAt }));
        tab.remove(KEY.tried);
        device.set(KEY.once, "1");
        return "signed-in";
      }
      try {
        const saved = JSON.parse(tab.get(KEY.token) ?? "null");
        if (saved && typeof saved.token === "string" && typeof saved.expiresAt === "number") {
          token = saved.token;
          expiresAt = saved.expiresAt;
        }
      } catch {
        // a broken entry: as if there were none
      }
      return valid() ? "signed-in" : "none";
    },

    /**
     * Sign in again without anybody tapping anything: only where somebody has signed in
     * before, and only once per tab until it works (never a redirect loop). Returns true
     * if the page is leaving for Google.
     */
    silent() {
      if (valid() || device.get(KEY.once) !== "1" || tab.get(KEY.tried) === "1") return false;
      tab.set(KEY.tried, "1");
      go(true);
      return true;
    },

    /** The "Belépés" button: off to Google; the page comes back signed in. */
    signIn() {
      go(false);
      return new Promise(() => {}); // the page is leaving
    },

    /** The token ran out or was refused: forget it (the device still counts as signed in). */
    forget() {
      token = "";
      expiresAt = 0;
      tab.remove(KEY.token);
    },

    /** "Kijelentkezés": from now on nobody is signed in here without pressing the button. */
    signOut() {
      this.forget();
      device.remove(KEY.once);
      tab.remove(KEY.tried);
    },
  };
}
