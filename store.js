// The local queue in IndexedDB: the rounds, and the photos that are not uploaded yet.
// A photo is deleted from here the moment it is on the drive.

const DB_NAME = "faliujsag-foto";
const DB_VERSION = 1; // never raise it lightly: an old tab left open blocks the upgrade
const WALL_KEY = "faliujsag-foto.wall"; // the check-list of the day: small, so localStorage

function wait(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class BrowserStore {
  constructor() {
    this.db = null;
  }

  async _open() {
    if (this.db) return this.db;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("rounds", { keyPath: "id" });
      request.result.createObjectStore("photos", { keyPath: "id" });
    };
    this.db = await wait(request);
    return this.db;
  }

  async _run(name, mode, action) {
    const db = await this._open();
    return wait(action(db.transaction(name, mode).objectStore(name)));
  }

  getRounds() {
    return this._run("rounds", "readonly", (s) => s.getAll());
  }
  putRound(round) {
    return this._run("rounds", "readwrite", (s) => s.put(round));
  }
  deleteRound(id) {
    return this._run("rounds", "readwrite", (s) => s.delete(id));
  }
  getPhotos() {
    return this._run("photos", "readonly", (s) => s.getAll());
  }
  putPhoto(photo) {
    return this._run("photos", "readwrite", (s) => s.put(photo));
  }
  deletePhoto(id) {
    return this._run("photos", "readwrite", (s) => s.delete(id));
  }
  async getMeta() {
    try {
      return JSON.parse(localStorage.getItem(WALL_KEY) ?? "null");
    } catch {
      return null; // private mode or a broken entry: the list simply starts clean
    }
  }
  async putMeta(meta) {
    try {
      localStorage.setItem(WALL_KEY, JSON.stringify(meta));
    } catch {
      // not remembered: only the ticks are lost, never a photo
    }
  }
}
