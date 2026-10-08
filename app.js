// The screen: sign in, take photos, "Kész". All the logic lives in rounds.js / drive.js.

import { createAuth } from "./auth.js";
import { BOTTOM, TOP, allItems, markOf } from "./check.js";
import { CONFIG } from "./config.js";
import { createDrive } from "./drive.js";
import { GROUPS } from "./layout.js";
import { inspect } from "./photo.js";
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
      chip.textContent = isEmpty
        ? `${number} üres`
        : top && bottom ? `✓ ${number}` : top ? `${number} ▲` : bottom ? `${number} ▼` : number;
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
  $("wall-title").textContent = `Megvan ebben a körben: ${whole} / ${ITEM_COUNT}${halves}`;
  $("wall-legend").hidden = half === 0;
  $("done").classList.toggle("ready", whole === ITEM_COUNT);
}

async function toggleEmpty(item, photographed, isEmpty) {
  if (photographed && !isEmpty) {
    say("Erről az ajtóról ebben a körben már van fotó, ezért nem jelölhető üresnek.");
    return;
  }
  await rounds.setEmpty(item.id, !isEmpty);
  finishing = false;
  say("");
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
  finishing = false;
  await sync();
}

/** A fresh photo: look at it first; with a warning the photographer decides. */
async function take(file) {
  closeReview();
  $("last").textContent = "";
  say("Megnézem a fotót…");
  let verdict = null;
  try {
    verdict = await inspect(file);
  } catch {
    verdict = null; // the check is only advice: a photo is never lost because of it
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
  $("setup").hidden = configured;
  $("signin").hidden = !configured || auth.signedIn();
  $("done").disabled = !status.open || (status.taken === 0 && status.empty.length === 0);
  renderWall(status.marks, status.empty);
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
