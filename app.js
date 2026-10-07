// The screen: sign in, take photos, "Kész". All the logic lives in rounds.js / drive.js.

import { createAuth } from "./auth.js";
import { CONFIG } from "./config.js";
import { createDrive } from "./drive.js";
import { Rounds } from "./rounds.js";
import { BrowserStore } from "./store.js";

const RETRY_EVERY_MS = 30_000;
const $ = (id) => document.getElementById(id);
const configured = Boolean(CONFIG.clientId && CONFIG.inboxFolderId);

const auth = createAuth(CONFIG);
const rounds = new Rounds({
  store: new BrowserStore(),
  drive: createDrive({ getToken: auth.getToken }),
  inboxFolderId: CONFIG.inboxFolderId,
});
let finishing = false; // "Kész" was tapped: say so once the round is really up

function say(text, kind = "") {
  $("status").textContent = text;
  $("status").className = `status ${kind}`.trim();
}

async function render() {
  const status = await rounds.status();
  $("setup").hidden = configured;
  $("signin").hidden = !configured || auth.signedIn();
  $("done").disabled = !status.open || status.taken === 0;
  if (status.taken === 0 && status.waiting === 0) {
    $("counts").textContent = "";
  } else {
    const waiting = status.waiting ? ` · várakozik: ${status.waiting}` : "";
    $("counts").textContent = `Ebben a körben ${status.taken} fotó · feltöltve: ${status.uploaded}${waiting}`;
  }
  return status;
}

async function sync() {
  const before = await render();
  if (!configured || (before.waiting === 0 && !before.closing)) return;
  if (auth.signedIn()) say("Feltöltés…");
  const result = await rounds.pump();
  const after = await render();
  if (result.state === "signin") {
    auth.forget();
    await render();
    say(result.message, "bad");
  } else if (result.state !== "idle") {
    say(result.message, result.state === "blocked" ? "bad" : "");
  } else if (finishing && !after.closing) {
    finishing = false;
    say("Kész, a kör felment! Kb. 10 perc múlva látszik a faliújságon.", "ok");
  } else {
    say("Minden fotó felment. Jöhet a következő, vagy nyomd meg a Kész gombot.", "ok");
  }
}

function guard(action) {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      // Our own messages are Hungarian and safe; anything else gets a plain one.
      const known = error instanceof Error && /[áéíóöőúüű]/i.test(error.message);
      say(known ? error.message : "Váratlan hiba történt. Töltsd újra az oldalt.", "bad");
    }
  };
}

$("camera").addEventListener(
  "change",
  guard(async (event) => {
    const files = [...event.target.files];
    event.target.value = ""; // the same photo slot can be used again
    for (const file of files) await rounds.addPhoto(file);
    finishing = false;
    await sync();
  }),
);

$("signin").addEventListener(
  "click",
  guard(async () => {
    await auth.signIn();
    say("");
    await sync();
    await render();
  }),
);

$("done").addEventListener(
  "click",
  guard(async () => {
    await rounds.finish();
    finishing = true;
    await sync();
  }),
);

window.addEventListener("online", guard(sync));
document.addEventListener(
  "visibilitychange",
  guard(async () => {
    if (!document.hidden) await sync();
  }),
);
setInterval(guard(sync), RETRY_EVERY_MS);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

guard(async () => {
  const status = await render();
  finishing = status.closing;
  if (status.waiting && !auth.signedIn()) {
    say(`${status.waiting} fotó vár feltöltésre. Lépj be, és felmennek.`);
  }
})();
