// A round of photos: taken one after the other, uploaded into one folder of the inbox
// (`faliujsag/bejovo/<round id>/`), closed with a `done.json` – the processor only reads
// a round once that file is there.
//
// A photo is first saved locally (the store), then uploaded and removed: without network
// nothing is lost, and nothing stays on the phone afterwards.

import { DriveError } from "./drive.js";

// The processor (rmg_tools: board_worker/drive.py) skips anything bigger or of another kind.
export const MAX_PHOTO_BYTES = 40 * 1024 * 1024;
const ENDINGS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
};
export const DONE_FILE = "done.json";

const two = (n) => String(n).padStart(2, "0");

export function newRoundId(now = new Date(), random = Math.random) {
  const date = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const tail = Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${date}-${time}-${tail}`;
}

export function photoName(index, type) {
  return `foto-${two(index)}.${ENDINGS[type] ?? "jpg"}`;
}

export class Rounds {
  constructor({ store, drive, inboxFolderId, now = () => new Date(), random = Math.random }) {
    this.store = store;
    this.drive = drive;
    this.inboxFolderId = inboxFolderId;
    this.now = now;
    this.random = random;
    this.running = null;
  }

  async _open() {
    return (await this.store.getRounds()).find((round) => !round.closing) ?? null;
  }

  /** Save a freshly taken photo into the open round (starting one if there is none). */
  async addPhoto(blob) {
    if (blob.type && !blob.type.startsWith("image/")) {
      throw new Error("Ez nem kép. Fotót készíts a kamerával.");
    }
    if (blob.size > MAX_PHOTO_BYTES) {
      throw new Error("Ez a fotó túl nagy (40 MB fölött van), a feldolgozó nem fogadja el.");
    }
    const started = this.now();
    const round = (await this._open()) ?? {
      id: newRoundId(started, this.random),
      startedAt: started.toISOString(),
      folderId: null,
      taken: 0,
      uploaded: 0,
      closing: false,
    };
    round.taken += 1;
    // The photo first: a round that counts a photo it does not have could never close.
    await this.store.putPhoto({
      id: `${round.id}/${two(round.taken)}`,
      roundId: round.id,
      name: photoName(round.taken, blob.type),
      blob,
    });
    await this.store.putRound(round);
  }

  /** "Kész": no more photos in this round; done.json follows the last upload. */
  async finish() {
    const round = await this._open();
    if (!round) return;
    if (round.taken === 0) {
      await this.store.deleteRound(round.id);
      return;
    }
    round.closing = true;
    await this.store.putRound(round);
  }

  /** What the screen shows: the open round (or the one still closing), and the whole queue. */
  async status() {
    const rounds = await this.store.getRounds();
    const waiting = (await this.store.getPhotos()).length;
    const open = rounds.find((round) => !round.closing);
    const shown = open ?? rounds[rounds.length - 1];
    return {
      open: Boolean(open),
      closing: rounds.some((round) => round.closing),
      taken: shown?.taken ?? 0,
      uploaded: shown?.uploaded ?? 0,
      waiting,
    };
  }

  /**
   * Upload whatever waits. Returns {state, message}:
   * idle (all up), waiting (try again later), signin (sign in again), blocked (needs a human).
   */
  pump() {
    this.running ??= this._pump().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async _pump() {
    try {
      const rounds = await this.store.getRounds();
      rounds.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      for (const round of rounds) {
        await this._uploadRound(round);
      }
      return { state: "idle", message: "" };
    } catch (error) {
      if (!(error instanceof DriveError)) throw error;
      const state = error.auth ? "signin" : error.retryable ? "waiting" : "blocked";
      return { state, message: error.message };
    }
  }

  async _uploadRound(round) {
    const photos = (await this.store.getPhotos())
      .filter((photo) => photo.roundId === round.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (photos.length && !round.folderId) {
      round.folderId = await this.drive.createFolder(round.id, this.inboxFolderId);
      await this.store.putRound(round);
    }
    for (const photo of photos) {
      await this.drive.uploadFile(photo.name, photo.blob, round.folderId);
      await this.store.deletePhoto(photo.id);
      round.uploaded += 1;
      await this.store.putRound(round);
    }
    if (!round.closing) return;
    if (round.folderId) {
      // Counts only: who took the photos is nobody's business in a file (Drive knows anyway).
      const done = { schema: 1, photos: round.uploaded, finished_at: this.now().toISOString() };
      const blob = new Blob([JSON.stringify(done)], { type: "application/json" });
      await this.drive.uploadFile(DONE_FILE, blob, round.folderId);
    }
    await this.store.deleteRound(round.id);
  }
}
