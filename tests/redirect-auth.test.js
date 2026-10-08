import assert from "node:assert/strict";
import { test } from "node:test";

import { authUrl, createRedirectAuth, parseReturn, redirectUriOf } from "../redirect-auth.js";

class FakeStorage {
  constructor() {
    this.data = new Map();
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    this.data.set(key, String(value));
  }
  removeItem(key) {
    this.data.delete(key);
  }
}

/** A browser tab on a phone: its storages, its address, and where it was sent. */
function phone({ session = new FakeStorage(), local = new FakeStorage(), hash = "" } = {}) {
  const location = {
    origin: "https://example.github.io",
    pathname: "/foto/",
    search: "",
    hash,
    sent: [],
    assign(url) {
      this.sent.push(url);
    },
  };
  const history = {
    replaced: [],
    replaceState(_state, _title, url) {
      this.replaced.push(url);
      location.hash = "";
    },
  };
  const clock = { now: 1_000_000 };
  let counter = 0;
  const auth = createRedirectAuth({
    clientId: "client",
    scope: "scope",
    getHint: () => "tanar@example.edu",
    session,
    local,
    location,
    history,
    now: () => clock.now,
    makeState: () => `state-${++counter}`,
  });
  return { auth, session, local, location, history, clock };
}

const sentParams = (location) => new URL(location.sent.at(-1)).searchParams;

test("the address for Google: silent with a hint, or asking which account", () => {
  const base = { clientId: "c", scope: "s", redirectUri: "https://x/y/", state: "st" };
  const silent = new URL(authUrl({ ...base, hint: "a@b.hu", silent: true })).searchParams;
  assert.equal(silent.get("prompt"), "none");
  assert.equal(silent.get("login_hint"), "a@b.hu");
  assert.equal(silent.get("response_type"), "token");
  assert.equal(silent.get("redirect_uri"), "https://x/y/");

  const asking = new URL(authUrl({ ...base, hint: "", silent: false })).searchParams;
  assert.equal(asking.get("prompt"), "select_account");
  assert.ok(!asking.has("login_hint"));
  const hinted = new URL(authUrl({ ...base, hint: "a@b.hu", hostedDomain: "b.hu", silent: false }));
  assert.ok(!hinted.searchParams.has("prompt"));
  assert.equal(hinted.searchParams.get("hd"), "b.hu");
});

test("only Google's answer is read out of the address", () => {
  assert.equal(parseReturn(""), null);
  assert.equal(parseReturn("#valami"), null);
  assert.deepEqual(parseReturn("#access_token=tok&expires_in=3599&state=s1&token_type=Bearer"), {
    token: "tok", expiresIn: 3599, state: "s1", error: "",
  });
  assert.equal(parseReturn("#error=interaction_required&state=s1").error, "interaction_required");
});

test("the answer always comes back to the app's own address, without index.html", () => {
  const at = (pathname) => redirectUriOf({ origin: "https://example.github.io", pathname });
  assert.equal(at("/foto/"), "https://example.github.io/foto/");
  assert.equal(at("/foto/index.html"), "https://example.github.io/foto/");
});

test("the button sends the page to Google, and it comes back signed in", async () => {
  const first = phone();
  assert.equal(first.auth.restore(), "none");
  first.auth.signIn();
  const asked = sentParams(first.location);
  assert.equal(asked.get("state"), "state-1");
  assert.equal(asked.get("login_hint"), "tanar@example.edu");
  assert.equal(asked.get("redirect_uri"), "https://example.github.io/foto/");

  // The page loads again, with Google's answer in the address.
  const back = phone({
    session: first.session, local: first.local,
    hash: "#access_token=tok-1&expires_in=3600&state=state-1",
  });
  assert.equal(back.auth.restore(), "signed-in");
  assert.equal(await back.auth.getToken(), "tok-1");
  assert.deepEqual(back.history.replaced, ["/foto/"]); // the token left the address bar
  assert.equal(back.local.getItem("faliujsag-foto.signed-in-once"), "1");

  // A reload of the same tab within the hour: still signed in, nobody is sent anywhere.
  const reloaded = phone({ session: first.session, local: first.local });
  assert.equal(reloaded.auth.restore(), "signed-in");
  assert.equal(reloaded.auth.silent(), false);
  assert.deepEqual(reloaded.location.sent, []);
});

test("an answer nobody asked for is ignored", async () => {
  const forged = phone({ hash: "#access_token=evil&expires_in=3600&state=guess" });
  assert.equal(forged.auth.restore(), "none");
  assert.equal(forged.auth.signedIn(), false);
  assert.deepEqual(forged.history.replaced, ["/foto/"]); // …but still wiped from the address
  await assert.rejects(forged.auth.getToken(), (error) => error.auth === true);
});

test("opening the app later signs in by itself – only where somebody signed in before", () => {
  const stranger = phone();
  stranger.auth.restore();
  assert.equal(stranger.auth.silent(), false); // never sent to Google unasked
  assert.deepEqual(stranger.location.sent, []);

  const local = new FakeStorage();
  local.setItem("faliujsag-foto.signed-in-once", "1");
  const known = phone({ local }); // a new tab, days later: no token
  assert.equal(known.auth.restore(), "none");
  assert.equal(known.auth.silent(), true);
  assert.equal(sentParams(known.location).get("prompt"), "none");

  const back = phone({
    session: known.session, local,
    hash: "#access_token=tok-2&expires_in=3600&state=state-1",
  });
  assert.equal(back.auth.restore(), "signed-in");
});

test("if Google will not sign in silently, the button is shown – no redirect loop", () => {
  const local = new FakeStorage();
  local.setItem("faliujsag-foto.signed-in-once", "1");
  const known = phone({ local });
  known.auth.restore();
  assert.equal(known.auth.silent(), true);

  const back = phone({
    session: known.session, local, hash: "#error=interaction_required&state=state-1",
  });
  assert.equal(back.auth.restore(), "refused");
  assert.equal(back.auth.silent(), false); // not tried again in this tab
  assert.deepEqual(back.location.sent, []);
});

test("a token that ran out is renewed silently, once", () => {
  const first = phone();
  first.auth.signIn();
  const back = phone({
    session: first.session, local: first.local,
    hash: "#access_token=tok-1&expires_in=3600&state=state-1",
  });
  back.auth.restore();
  assert.equal(back.auth.silent(), false); // still valid

  back.clock.now += 3600 * 1000;
  assert.equal(back.auth.signedIn(), false);
  assert.equal(back.auth.silent(), true);
  assert.equal(back.auth.silent(), false);
});

test("signing out: nobody is signed in here again without pressing the button", () => {
  const first = phone();
  first.auth.signIn();
  const back = phone({
    session: first.session, local: first.local,
    hash: "#access_token=tok-1&expires_in=3600&state=state-1",
  });
  back.auth.restore();
  back.auth.signOut();

  assert.equal(back.auth.signedIn(), false);
  assert.equal(back.auth.silent(), false);
  const later = phone({ session: new FakeStorage(), local: first.local });
  assert.equal(later.auth.restore(), "none");
  assert.equal(later.auth.silent(), false);
});
