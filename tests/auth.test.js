import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createAuth } from "../auth.js";

// A stand-in for Google Identity Services: remembers how it was asked, answers at once.
function fakeGoogle(answer = { access_token: "tok", expires_in: 3600 }) {
  const asked = [];
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient: (options) => ({
          requestAccessToken: (extra) => {
            asked.push({ options, extra });
            options.callback(answer);
          },
        }),
      },
    },
  };
  return asked;
}

afterEach(() => {
  delete globalThis.google;
});

test("signing in asks for the remembered account, so the chooser does not pick a wrong one", async () => {
  const asked = fakeGoogle();
  const auth = createAuth({
    clientId: "client", scope: "scope", hostedDomain: "", getHint: () => "tanar@example.edu",
  });

  assert.equal(auth.signedIn(), false);
  await auth.signIn();

  assert.equal(auth.signedIn(), true);
  assert.equal(await auth.getToken(), "tok");
  assert.equal(asked[0].options.login_hint, "tanar@example.edu");
  assert.equal(asked[0].options.client_id, "client");
  assert.ok(!("hd" in asked[0].options));
});

test("without a remembered account nothing is hinted; a school domain narrows the chooser", async () => {
  const asked = fakeGoogle();
  await createAuth({ clientId: "c", scope: "s", hostedDomain: "", getHint: () => "" }).signIn();
  assert.ok(!("login_hint" in asked[0].options));

  await createAuth({ clientId: "c", scope: "s", hostedDomain: "example.edu" }).signIn();
  assert.equal(asked[1].options.hd, "example.edu");
});

test("a refused sign-in is a Hungarian message, and nobody is signed in", async () => {
  fakeGoogle({ error: "access_denied" });
  const auth = createAuth({ clientId: "c", scope: "s" });
  await assert.rejects(auth.signIn(), /belépés/);
  assert.equal(auth.signedIn(), false);
  await assert.rejects(auth.getToken(), (error) => error.auth === true);
});
