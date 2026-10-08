// Test doubles: an in-memory store and a scripted fetch. No real Google, no real photo.

export class MemoryStore {
  constructor() {
    this.rounds = new Map();
    this.photos = new Map();
  }
  async getRounds() {
    return [...this.rounds.values()].map((r) => ({ ...r }));
  }
  async putRound(round) {
    this.rounds.set(round.id, { ...round });
  }
  async deleteRound(id) {
    this.rounds.delete(id);
  }
  async getPhotos() {
    return [...this.photos.values()].map((p) => ({ ...p }));
  }
  async putPhoto(photo) {
    this.photos.set(photo.id, { ...photo });
  }
  async deletePhoto(id) {
    this.photos.delete(id);
  }
  async getMeta() {
    return this.meta ? structuredClone(this.meta) : null;
  }
  async putMeta(meta) {
    this.meta = structuredClone(meta);
  }
}

export function response(status, body = {}, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

/** A fetch that answers from a list (a function is called, an Error is thrown) and logs the calls. */
export function scriptedFetch(answers) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (answers.length === 0) throw new Error("unexpected request: " + url);
    let answer = answers.shift();
    if (typeof answer === "function") answer = answer(url, options);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetchFn, calls };
}

/** A Drive double for the round logic: remembers what was created, fails on demand. */
export class FakeDrive {
  constructor() {
    this.folders = [];
    this.files = [];
    this.failures = []; // errors thrown by the next calls, in order
  }
  _maybeFail() {
    if (this.failures.length) throw this.failures.shift();
  }
  async createFolder(name, parentId) {
    this._maybeFail();
    const id = `folder-${this.folders.length + 1}`;
    this.folders.push({ id, name, parentId });
    return id;
  }
  async uploadFile(name, blob, parentId) {
    this._maybeFail();
    const id = `file-${this.files.length + 1}`;
    this.files.push({ id, name, parentId, blob });
    return id;
  }
}

export function fakeBlob(type = "image/jpeg", size = 1000) {
  return { type, size };
}
