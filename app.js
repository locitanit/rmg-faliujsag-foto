// The screen: sign in, take photos, "Befejezés". All the logic lives in rounds.js / drive.js.

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
// A batch is sent with "Befejezés"; a forgotten one goes by itself this long after the last
// photo / tap (and when the app is opened again later).
const IDLE_CLOSE_MS = 15 * 60_000;
const IDLE_CHECK_MS = 30_000;
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

let fresh = new Set(); // the pieces the last photo showed: outlined on the map

function stateText(top, bottom, isEmpty) {
  if (isEmpty) return "üresnek jelölve";
  return top && bottom ? "megvan" : top ? "csak a teteje van meg" : bottom ? "csak az alja van meg" : "nincs meg";
}

/**
 * The wall map of this batch: every door and board piece drawn roughly to scale (layout.js
 * boxes, in mm), filled where a photo of the batch shows it, crossed where it was tapped
 * empty. Cabinets on the first line, boards on the second, both at the same scale.
 */
function renderWall(marks, emptyDoors) {
  const have = new Set(marks);
  const empty = new Set(emptyDoors);
  const lines = [...new Set(GROUPS.map((group) => group.line))].sort();
  const widths = lines.map((line) =>
    GROUPS.filter((group) => group.line === line).reduce((sum, group) => sum + group.size.w, 0),
  );
  const widest = Math.max(...widths);
  const wall = $("wall");
  wall.replaceChildren();
  let whole = 0;
  let half = 0;
  lines.forEach((line, lineIndex) => {
    const row = document.createElement("div");
    row.className = "map-line";
    for (const group of GROUPS.filter((each) => each.line === line)) {
      const box = document.createElement("div");
      box.className = "map-group";
      box.style.flexGrow = String(group.size.w);
      const plan = document.createElement("div");
      plan.className = "map-plan";
      plan.style.aspectRatio = `${group.size.w} / ${group.size.h}`;
      group.items.forEach((item) => {
        const top = have.has(markOf(item.id, TOP));
        const bottom = have.has(markOf(item.id, BOTTOM));
        const isEmpty = empty.has(item.id);
        // A cabinet door is a button: a tap says "nothing hangs on it" (and a tap takes it back).
        const piece = document.createElement(item.canBeEmpty ? "button" : "span");
        const look = isEmpty ? " empty" : top && bottom ? " have" : top ? " top" : bottom ? " bottom" : "";
        piece.className = `piece${look}${fresh.has(item.id) ? " fresh" : ""}`;
        const { x, y, w, h } = item.box;
        piece.style.left = `${(100 * x) / group.size.w}%`;
        piece.style.top = `${(100 * y) / group.size.h}%`;
        piece.style.width = `${(100 * w) / group.size.w}%`;
        piece.style.height = `${(100 * h) / group.size.h}%`;
        // Doors get their number; the side wall and board pieces are known by their place.
        if (/ajtó$/.test(item.label)) piece.textContent = item.label.split(".")[0];
        piece.title = `${group.name} – ${item.label}: ${stateText(top, bottom, isEmpty)}`;
        piece.setAttribute("aria-label", piece.title);
        if (item.canBeEmpty) {
          piece.type = "button";
          piece.setAttribute("aria-pressed", String(isEmpty));
          piece.addEventListener("click", guard(() => toggleEmpty(item, top || bottom, isEmpty)));
        }
        if (isEmpty || (top && bottom)) whole += 1;
        else if (top || bottom) half += 1;
        plan.append(piece);
      });
      const name = document.createElement("div");
      name.className = "group-name";
      name.textContent = group.name;
      box.append(plan, name);
      row.append(box);
    }
    // A shorter line keeps the scale of the widest one: the rest of it is left empty.
    const rest = widest - widths[lineIndex];
    if (rest > 0) {
      const spacer = document.createElement("div");
      spacer.style.flexGrow = String(rest);
      row.append(spacer);
    }
    wall.append(row);
  });
  const halves = half ? ` (+ ${half} félig)` : "";
  const all = whole === ITEM_COUNT ? " – minden megvan ✓" : "";
  $("wall-title").textContent = `Ebben a körben: ${whole} / ${ITEM_COUNT}${halves}${all}`;
}

async function toggleEmpty(item, photographed, isEmpty) {
  if (photographed && !isEmpty) {
    say("Erről az ajtóról ebben a körben már van fotó, ezért nem jelölhető üresnek.");
    return;
  }
  await rounds.setEmpty(item.id, !isEmpty);
  say(isEmpty ? "" : "Rendben, üresnek jelöltem – a Befejezéssel megy el.");
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
  fresh = new Set(verdict?.items ?? []);
  if (!verdict) {
    $("last").textContent = "Ezt a fotót nem tudtam ellenőrizni, de eltettem.";
  } else if (verdict.labels.length) {
    $("last").textContent = `✓ Felismertem: ${verdict.labels.join(", ")}`;
  } else {
    $("last").textContent = "Eltettem.";
  }
  await render();
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
  $("finish").disabled = status.taken + status.empty.length === 0;
  $("finish").textContent = status.taken
    ? `Befejezés – ${status.taken} fotó elküldése`
    : status.empty.length ? "Befejezés – elküldés" : "Befejezés";
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
    say("Elküldve. Kb. 10–15 perc múlva látszik az RMG Toolsban.", "ok");
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

$("finish").addEventListener(
  "click",
  guard(async () => {
    closeReview(); // a photo still waiting for "Így is jó" is not sent
    await rounds.finish();
    fresh = new Set();
    $("last").textContent = "";
    await sync();
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

// The top bar: instructions (closed until asked for; this phone remembers), the
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
    // private mode: closed again next time, nothing else is lost
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
  showHelp(localStorage.getItem(HELP_KEY) === "on");
} catch {
  showHelp(false);
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
