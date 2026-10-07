import assert from "node:assert/strict";
import { test } from "node:test";

import { DriveError, createDrive } from "../drive.js";
import { response, scriptedFetch } from "./helpers.js";

function drive(answers, extra = {}) {
  const { fetchFn, calls } = scriptedFetch(answers);
  const waits = [];
  const api = createDrive({
    fetchFn,
    getToken: async () => "token-1",
    sleep: async (ms) => waits.push(ms),
    ...extra,
  });
  return { api, calls, waits };
}

test("a folder is created inside the given parent, on a shared drive too", async () => {
  const { api, calls } = drive([response(200, { id: "f1", parents: ["inbox"] })]);

  assert.equal(await api.createFolder("20261008-101500-ab12", "inbox"), "f1");

  const { url, options } = calls[0];
  assert.match(url, /\/drive\/v3\/files\?/);
  assert.match(url, /supportsAllDrives=true/);
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer token-1");
  assert.deepEqual(JSON.parse(options.body), {
    name: "20261008-101500-ab12",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["inbox"],
  });
});

test("a folder that landed somewhere else is refused", async () => {
  const { api } = drive([response(200, { id: "f1", parents: ["elsewhere"] })]);
  await assert.rejects(api.createFolder("x", "inbox"), DriveError);
});

test("a file goes up in two steps: session, then the bytes", async () => {
  const blob = { type: "image/jpeg", size: 3 };
  const { api, calls } = drive([
    response(200, {}, { location: "https://upload.example/session-1" }),
    response(200, { id: "p1", parents: ["round"] }),
  ]);

  assert.equal(await api.uploadFile("foto-01.jpg", blob, "round"), "p1");

  assert.match(calls[0].url, /\/upload\/drive\/v3\/files\?/);
  assert.match(calls[0].url, /uploadType=resumable/);
  assert.match(calls[0].url, /supportsAllDrives=true/);
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: "foto-01.jpg", parents: ["round"] });
  assert.equal(calls[1].url, "https://upload.example/session-1");
  assert.equal(calls[1].options.method, "PUT");
  assert.equal(calls[1].options.body, blob);
});

test("rate limits and server errors are retried with a growing wait", async () => {
  const { api, calls, waits } = drive([
    response(429),
    response(503),
    response(200, { id: "f1", parents: ["inbox"] }),
  ]);

  assert.equal(await api.createFolder("x", "inbox"), "f1");
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test("a rate-limit 403 is retried, a permission 403 is not", async () => {
  const limited = { error: { errors: [{ reason: "userRateLimitExceeded" }] } };
  const first = drive([response(403, limited), response(200, { id: "f1", parents: ["inbox"] })]);
  assert.equal(await first.api.createFolder("x", "inbox"), "f1");

  const denied = { error: { errors: [{ reason: "insufficientFilePermissions" }] } };
  const second = drive([response(403, denied)]);
  await assert.rejects(second.api.createFolder("x", "inbox"), (error) => {
    assert.ok(error instanceof DriveError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /jogosultság/);
    return true;
  });
  assert.equal(second.calls.length, 1);
});

test("a missing folder is not retried and says what to check", async () => {
  const { api, calls } = drive([response(404)]);
  await assert.rejects(api.createFolder("x", "inbox"), (error) => {
    assert.equal(error.retryable, false);
    assert.match(error.message, /mappája/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("an expired sign-in is not retried: the user has to sign in again", async () => {
  const { api, calls } = drive([response(401)]);
  await assert.rejects(api.createFolder("x", "inbox"), (error) => {
    assert.equal(error.auth, true);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("no network: a bounded number of tries, then a retryable error", async () => {
  const down = () => new TypeError("Failed to fetch");
  const { api, calls } = drive([down(), down(), down(), down()]);
  await assert.rejects(api.createFolder("x", "inbox"), (error) => {
    assert.ok(error instanceof DriveError);
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(calls.length, 4);
});

test("every request carries a timeout signal", async () => {
  const { api, calls } = drive([response(200, { id: "f1", parents: ["inbox"] })]);
  await api.createFolder("x", "inbox");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test("error messages never carry the token or a file name", async () => {
  const { api } = drive([response(404)]);
  await assert.rejects(api.uploadFile("titkos-nev.jpg", { type: "image/jpeg", size: 1 }, "r"), (error) => {
    assert.ok(!error.message.includes("titkos-nev"));
    assert.ok(!error.message.includes("token-1"));
    return true;
  });
});
