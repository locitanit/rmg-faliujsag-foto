// The screen: sign in, take photos, "Kész". All the logic lives in rounds.js / drive.js.

import { createAuth } from "./auth.js";
import { BOTTOM, TOP, allItems, markOf } from "./check.js";
import { CONFIG } from "./config.js";
import { createDrive } from "./drive.js";
import { GROUPS } from "./layout.js";
import { inspect } from "./photo.js";
import { createRedirectAuth } from "./redirect-auth.js";
import { Rounds } from "./rounds.js";
import { BrowserStore } from "./store.js";

const RETRY_EVERY_MS = 30_000;
// A round closes by itself this long after the last photo / tap: there is no "Kész" button.
const IDLE_CLOSE_MS = 30_000;
const IDLE_CHECK_MS = 5_000;
const $ = (id) => document.getElementById(id);
const configured = Boolean(CONFIG.clientId && CONFIG.inboxFolderId);

const HINT_KEY = "faliujsag-foto.account"; // on this phone only; never uploaded anywhere

function savedHint() {
  try {
    return localStorage.getItem(HINT_KEY) ?? "";
  } catch {
    return ""; // private mode: simply no remembered account
  }
}

function rememberHint() {
  const typed = $("hint").value.trim();
  if (typed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typed)) {
    throw new Error("Ez nem e-mail cím. Írd be az iskolai címedet, vagy hagyd üresen.");
  }
  try {
    if (typed) localStorage.setItem(HINT_KEY, typed);
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // not remembered, but this sign-in still uses it (the field keeps the text)
  }
}

// Sign-in by redirect (config.js) signs in by itself when the app is opened. Not in an
// iPhone home-screen app: there a redirect opens in a separate browser sheet and never
// comes back into the app, so the pop-up stays.
const redirectMode = Boolean(CONFIG.redirectSignIn) && !navigator.standalone;
const authOptions = { ...CONFIG, getHint: () => $("hint").value.trim() || savedHint() };
const auth = redirectMode ? createRedirectAuth(authOptions) : createAuth(authOptions);
let busy = false; // a photo is being looked at: not the moment to leave the page

/** Sign in again without a tap, if that is possible right now. True = the page is leaving. */
function renewSilently() {
  if (!redirectMode || !configured || busy || pending || !navigator.onLine) return false;
  if (!auth.silent()) return false;
  say("Belépés…");
  return true;
}
const rounds = new Rounds({
  store: new BrowserStore(),
  drive: createDrive({ getToken: auth.getToken }),
  inboxFolderId: CONFIG.inboxFolderId,
});
let pending = null; // a photo with warnings, waiting for "Újra fotózom" / "Így is jó"
const ITEM_COUNT = allItems(GROUPS).length;

/** The check-list: every door and board part, ticked when a photo of this round shows it. */
function renderWall(marks, emptyDoors) {
  const have = new Set(marks);
  const empty = new Set(emptyDoors);
  const wall = $("wall");
  wall.replaceChildren();
  let whole = 0;
  let half = 0;
  for (const group of GROUPS) {
    const box = document.createElement("div");
    const name = document.createElement("div");
    name.className = "group-name";
    name.textContent = group.name;
    const chips = document.createElement("div");
    chips.className = "chips";
    group.items.forEach((item, index) => {
      const top = have.has(markOf(item.id, TOP));
      const bottom = have.has(markOf(item.id, BOTTOM));
      const isEmpty = empty.has(item.id);
      // A cabinet door is a button: a tap says "nothing hangs on it" (and a tap takes it back).
      const chip = document.createElement(item.canBeEmpty ? "button" : "span");
      // A door photographed in two halves: the chip is green where the door is done.
      const look = isEmpty ? " empty" : top && bottom ? " have" : top ? " top" : bottom ? " bottom" : "";
      chip.className = `chip${look}`;
      const number = String(index + 1);
      // Only the number, in every state: the look says the rest, and the chip never grows.
      chip.textContent = number;
      const state = isEmpty
        ? "üresnek jelölve"
        : top && bottom ? "megvan" : top ? "csak a teteje van meg" : bottom ? "csak az alja van meg" : "nincs meg";
      chip.title = `${group.name} – ${item.label}: ${state}`;
      chip.setAttribute("aria-label", chip.title);
      if (item.canBeEmpty) {
        chip.type = "button";
        chip.setAttribute("aria-pressed", String(isEmpty));
        chip.addEventListener("click", guard(() => toggleEmpty(item, top || bottom, isEmpty)));
      }
      if (isEmpty || (top && bottom)) whole += 1;
      else if (top || bottom) half += 1;
      chips.append(chip);
    });
    box.append(name, chips);
    wall.append(box);
  }
  const halves = half ? ` (+ ${half} félig)` : "";
  const all = whole === ITEM_COUNT ? " – minden megvan ✓" : "";
  $("wall-title").textContent = `Ma megvan: ${whole} / ${ITEM_COUNT}${halves}${all}`;
}

async function toggleEmpty(item, photographed, isEmpty) {
  if (photographed && !isEmpty) {
    say("Erről az ajtóról ebben a körben már van fotó, ezért nem jelölhető üresnek.");
    return;
  }
  await rounds.setEmpty(item.id, !isEmpty);
  say(isEmpty ? "" : "Rendben, üresnek jelöltem – magától elküldöm.");
  await render();
}

function showReview(warnings) {
  $("review-text").replaceChildren(
    ...warnings.map((warning) => {
      const line = document.createElement("li");
      line.textContent = warning.text;
      return line;
    }),
  );
  $("review").hidden = false;
}

function closeReview() {
  pending = null;
  $("review").hidden = true;
}

async function keep(file, verdict) {
  await rounds.addPhoto(file, verdict?.marks ?? []);
  if (!verdict) {
    $("last").textContent = "Ezt a fotót nem tudtam ellenőrizni, de elmentettem.";
  } else if (verdict.labels.length) {
    $("last").textContent = `✓ ${verdict.labels.join(", ")}`;
  } else {
    $("last").textContent = "";
  }
  await sync();
}

/** A fresh photo: look at it first; with a warning the photographer decides. */
async function take(file) {
  closeReview();
  $("last").textContent = "";
  say("Megnézem a fotót…");
  let verdict = null;
  busy = true;
  try {
    verdict = await inspect(file);
  } catch {
    verdict = null; // the check is only advice: a photo is never lost because of it
  } finally {
    busy = false;
  }
  say("");
  if (verdict?.warnings.length) {
    pending = { file, verdict };
    showReview(verdict.warnings);
    return;
  }
  await keep(file, verdict);
}

function say(text, kind = "") {
  $("status").textContent = text;
  $("status").className = `status ${kind}`.trim();
}

async function render() {
  const status = await rounds.status();
  // Signed out: the sign-in box and nothing else. Signed in: the icons and the photo screen.
  const signedIn = configured && auth.signedIn();
  $("setup").hidden = configured;
  $("signin-box").hidden = !configured || signedIn;
  $("app-view").hidden = !signedIn;
  $("actions").hidden = !signedIn;
  if (!signedIn) {
    closeProfileMenu();
    if ($("install-dialog").open) $("install-dialog").close();
  }
  renderWall(status.marks, status.empty);
  $("counts").textContent = status.waiting
    ? `${status.waiting} fotó vár feltöltésre a telefonon`
    : "";
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
    if (renewSilently()) return; // back in a moment, signed in; nothing is lost meanwhile
    await render();
    say(result.message, "bad");
  } else if (result.state !== "idle") {
    say(result.message, result.state === "blocked" ? "bad" : "");
  } else if (!after.closing) {
    say("Minden felment. Kb. 10 perc múlva látszik a faliújságon.", "ok");
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
    for (const file of files) await take(file);
  }),
);

$("retake").addEventListener(
  "click",
  guard(async () => {
    closeReview(); // the photo is dropped: it was never saved or uploaded
    $("camera").click();
  }),
);

$("keep").addEventListener(
  "click",
  guard(async () => {
    const { file, verdict } = pending;
    closeReview();
    await keep(file, verdict);
  }),
);

$("signin").addEventListener(
  "click",
  guard(async () => {
    rememberHint();
    await auth.signIn();
    say("");
    await sync();
    await render();
  }),
);

window.addEventListener("online", guard(sync));
document.addEventListener(
  "visibilitychange",
  guard(async () => {
    if (document.hidden) return;
    if (!auth.signedIn() && renewSilently()) return;
    await sync();
  }),
);

// The top bar: instructions (shown until switched off; this phone remembers), the
// home-screen tip, and the account menu with "Kijelentkezés".
const HELP_KEY = "faliujsag-foto.help";

function showHelp(open) {
  $("help").hidden = !open;
  $("help-button").setAttribute("aria-expanded", String(open));
}

function closeProfileMenu() {
  $("profile-menu").hidden = true;
  $("profile-button").setAttribute("aria-expanded", "false");
}

$("help-button").addEventListener("click", () => {
  const open = $("help").hidden;
  showHelp(open);
  try {
    localStorage.setItem(HELP_KEY, open ? "on" : "off");
  } catch {
    // private mode: open again next time, nothing else is lost
  }
  if (open) $("help").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

$("install-button").addEventListener("click", () => {
  closeProfileMenu();
  $("install-dialog").showModal();
});
$("install-close").addEventListener("click", () => $("install-dialog").close());
$("install-dialog").addEventListener("click", (event) => {
  if (event.target === $("install-dialog")) $("install-dialog").close(); // a tap beside it
});

$("profile-button").addEventListener("click", () => {
  const open = $("profile-menu").hidden;
  $("profile-account").textContent = savedHint() || "Iskolai Google-fiók";
  $("profile-menu").hidden = !open;
  $("profile-button").setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("#profile-menu, #profile-button")) closeProfileMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProfileMenu();
});

$("signout").addEventListener(
  "click",
  guard(async () => {
    closeProfileMenu();
    // The pop-up sign-in keeps its token in memory only: forgetting it is the sign-out.
    if (auth.signOut) auth.signOut();
    else auth.forget();
    say("Kijelentkeztél. A fotók addig a telefonon várnak, amíg újra be nem lépsz.");
    await render();
  }),
);
setInterval(guard(sync), RETRY_EVERY_MS);
setInterval(
  guard(async () => {
    if (!pending && (await rounds.finishIdle(IDLE_CLOSE_MS))) await sync();
  }),
  IDLE_CHECK_MS,
);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

$("hint").value = savedHint();
try {
  showHelp(localStorage.getItem(HELP_KEY) !== "off");
} catch {
  showHelp(true);
}

guard(async () => {
  // Back from Google? Or opened after days? Either way: signed in before anything else.
  const back = redirectMode ? auth.restore() : "none";
  if (!auth.signedIn() && back !== "refused" && renewSilently()) return;
  await rounds.finishIdle(IDLE_CLOSE_MS); // a round left open last time
  const status = await render();
  if (back === "refused") {
    say("A Google most nem enged be magától. Nyomd meg a Belépés gombot.", "bad");
  } else if ((status.waiting || status.closing) && !auth.signedIn()) {
    say("Van, ami még a telefonon vár. Lépj be, és felmegy.");
  }
  if (auth.signedIn()) await sync();
})();
