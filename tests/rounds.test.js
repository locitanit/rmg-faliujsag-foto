import assert from "node:assert/strict";
import { test } from "node:test";

import { DriveError } from "../drive.js";
import { MAX_PHOTO_BYTES, Rounds, newRoundId, photoName } from "../rounds.js";
import { FakeDrive, MemoryStore, fakeBlob } from "./helpers.js";

const NOW = new Date(2026, 9, 8, 10, 15, 0);

function setup() {
  const store = new MemoryStore();
  const drive = new FakeDrive();
  const clock = { now: NOW };
  const rounds = new Rounds({
    store, drive, inboxFolderId: "inbox", now: () => clock.now, random: () => 0.5,
  });
  const later = (seconds) => {
    clock.now = new Date(clock.now.getTime() + seconds * 1000);
  };
  return { store, drive, rounds, later };
}

test("a round id is the date, the time and a few random characters", () => {
  assert.match(newRoundId(NOW, () => 0.5), /^20261008-101500-[a-z0-9]{4}$/);
  assert.notEqual(newRoundId(NOW, () => 0.1), newRoundId(NOW, () => 0.9));
});

test("photos are numbered; the ending follows the picture type", () => {
  assert.equal(photoName(1, "image/jpeg"), "foto-01.jpg");
  assert.equal(photoName(12, "image/heic"), "foto-12.heic");
  assert.equal(photoName(3, "image/png"), "foto-03.png");
  assert.equal(photoName(4, ""), "foto-04.jpg");
});

test("photos of a batch wait on the phone; nothing goes up before Befejezés", async () => {
  const { store, drive, rounds } = setup();

  await rounds.addPhoto(fakeBlob());
  await rounds.addPhoto(fakeBlob("image/heic"));
  let status = await rounds.status();
  assert.deepEqual([status.open, status.taken, status.waiting], [true, 2, 0]);
  assert.equal((await rounds.pump()).state, "idle");
  assert.equal(drive.folders.length + drive.files.length, 0);

  await rounds.finish();
  status = await rounds.status();
  assert.deepEqual([status.open, status.closing, status.waiting], [false, true, 2]);
  assert.equal((await rounds.pump()).state, "idle");
  assert.deepEqual(drive.folders, [{ id: "folder-1", name: "20261008-101500-i000", parentId: "inbox" }]);
  assert.deepEqual(
    drive.files.map((f) => [f.name, f.parentId]),
    [["foto-01.jpg", "folder-1"], ["foto-02.heic", "folder-1"], ["done.json", "folder-1"]],
  );
  assert.equal((await store.getPhotos()).length, 0); // nothing of the photos stays on the phone
  assert.equal((await store.getRounds()).length, 0);
});

test("finishing writes done.json last, with counts only; the next photo is a new batch", async () => {
  const { drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());
  await rounds.addPhoto(fakeBlob());
  await rounds.finish();
  await rounds.pump();

  const done = JSON.parse(await drive.files[2].blob.text());
  assert.deepEqual(done, { schema: 1, photos: 2, finished_at: NOW.toISOString(), empty: [] });

  await rounds.addPhoto(fakeBlob());
  await rounds.finish();
  await rounds.pump();
  assert.equal(drive.folders.length, 2);
});

test("finishing a round without photos uploads nothing", async () => {
  const { drive, rounds } = setup();
  await rounds.finish();
  await rounds.pump();
  assert.equal(drive.folders.length + drive.files.length, 0);
});

test("no network: the batch stays queued and goes up on the next try", async () => {
  const { store, drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());
  await rounds.addPhoto(fakeBlob());
  await rounds.finish();

  drive.failures.push(new DriveError("Nincs kapcsolat.", { retryable: true }));
  const first = await rounds.pump();
  assert.equal(first.state, "waiting");
  assert.equal(first.message, "Nincs kapcsolat.");
  assert.equal((await store.getPhotos()).length, 2);
  assert.equal((await rounds.status()).waiting, 2);

  // The folder was made before the failure? No – so it is made now, once.
  const second = await rounds.pump();
  assert.equal(second.state, "idle");
  assert.equal(drive.folders.length, 1);
  assert.deepEqual(drive.files.map((f) => f.name), ["foto-01.jpg", "foto-02.jpg", "done.json"]);
});

test("a failure in the middle keeps what is already up and continues from there", async () => {
  const { drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());
  await rounds.addPhoto(fakeBlob());
  await rounds.addPhoto(fakeBlob());
  await rounds.finish();
  // folder, photo 1, photo 2 work; photo 3 fails
  drive.failures.push(null, null, null, new DriveError("Nincs kapcsolat.", { retryable: true }));
  assert.equal((await rounds.pump()).state, "waiting");
  assert.equal((await rounds.pump()).state, "idle");

  assert.equal(drive.folders.length, 1);
  assert.deepEqual(
    drive.files.map((f) => f.name),
    ["foto-01.jpg", "foto-02.jpg", "foto-03.jpg", "done.json"],
  );
});

test("a permission problem stops the queue and is shown; an expired sign-in asks for sign-in", async () => {
  const { store, drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());
  await rounds.finish();

  drive.failures.push(new DriveError("Nincs jogosultságod.", { retryable: false }));
  assert.deepEqual(await rounds.pump(), { state: "blocked", message: "Nincs jogosultságod." });

  drive.failures.push(new DriveError("Lépj be újra.", { auth: true }));
  assert.deepEqual(await rounds.pump(), { state: "signin", message: "Lépj be újra." });
  assert.equal((await store.getPhotos()).length, 1);
});

test("the queue and the open batch survive a restart of the app", async () => {
  const { store, drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob(), ["sor-1-ajto-1:top"]);

  const reopened = new Rounds({ store, drive, inboxFolderId: "inbox", now: () => NOW });
  const status = await reopened.status();
  assert.deepEqual([status.open, status.taken, status.marks], [true, 1, ["sor-1-ajto-1:top"]]);
  await reopened.addPhoto(fakeBlob());
  await reopened.finish();
  assert.equal((await reopened.status()).waiting, 2);
  await reopened.pump();
  assert.equal(drive.folders.length, 1);
  assert.deepEqual(drive.files.map((f) => f.name), ["foto-01.jpg", "foto-02.jpg", "done.json"]);
});

test("two pumps at once do not upload a photo twice", async () => {
  const { drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());
  await rounds.finish();
  await Promise.all([rounds.pump(), rounds.pump()]);
  assert.deepEqual(drive.files.map((f) => f.name), ["foto-01.jpg", "done.json"]);
});

test("a file that is not a picture, or is too big for the processor, is refused", async () => {
  const { rounds } = setup();
  await assert.rejects(rounds.addPhoto(fakeBlob("application/pdf")), /kép/);
  await assert.rejects(rounds.addPhoto(fakeBlob("image/jpeg", MAX_PHOTO_BYTES + 1)), /nagy/);
  assert.equal((await rounds.status()).taken, 0);
});

test("the map shows one batch: its marks, cleared by Befejezés", async () => {
  const { rounds } = setup();
  await rounds.addPhoto(fakeBlob(), ["sor-1-ajto-1:top"]);
  await rounds.addPhoto(fakeBlob(), ["sor-1-ajto-2:top", "sor-1-ajto-1:top"]);
  await rounds.addPhoto(fakeBlob());
  assert.deepEqual((await rounds.status()).marks, ["sor-1-ajto-1:top", "sor-1-ajto-2:top"]);

  await rounds.finish();
  assert.deepEqual((await rounds.status()).marks, []); // sending: the next batch starts clean
  await rounds.pump();
  await rounds.addPhoto(fakeBlob(), ["oldalfal:top"]);
  assert.deepEqual((await rounds.status()).marks, ["oldalfal:top"]);
});

test("doors clicked empty travel in done.json – even in a round without a photo", async () => {
  const { drive, rounds } = setup();
  await rounds.setEmpty("sor-1-ajto-3", true);
  await rounds.setEmpty("sor-1-ajto-4", true);
  await rounds.setEmpty("sor-1-ajto-4", false); // clicked back
  let status = await rounds.status();
  assert.deepEqual([status.open, status.taken, status.empty], [true, 0, ["sor-1-ajto-3"]]);

  await rounds.pump();
  assert.equal(drive.folders.length + drive.files.length, 0); // nothing goes up before Befejezés

  await rounds.finish();
  assert.equal((await rounds.pump()).state, "idle");
  assert.equal(drive.folders.length, 1);
  assert.deepEqual(drive.files.map((f) => f.name), ["done.json"]);
  const done = JSON.parse(await drive.files[0].blob.text());
  assert.deepEqual([done.photos, done.empty], [0, ["sor-1-ajto-3"]]);
  status = await rounds.status();
  assert.deepEqual([status.open, status.empty], [false, []]); // the next batch starts clean
});

test("a photo of a door takes back its empty mark; unclicking everything leaves no round", async () => {
  const { store, rounds } = setup();
  await rounds.setEmpty("sor-1-ajto-1", true);
  await rounds.setEmpty("sor-1-ajto-2", true);
  await rounds.addPhoto(fakeBlob(), ["sor-1-ajto-1:top"]);
  assert.deepEqual((await rounds.status()).empty, ["sor-1-ajto-2"]);

  const other = setup();
  await other.rounds.setEmpty("sor-1-ajto-1", true);
  await other.rounds.setEmpty("sor-1-ajto-1", false);
  assert.equal((await other.store.getRounds()).length, 0);
  assert.equal((await store.getRounds()).length, 1);
});

test("a forgotten batch closes by itself after a long quiet time", async () => {
  const { drive, rounds, later } = setup();
  const QUIET = 15 * 60_000;
  await rounds.addPhoto(fakeBlob(), ["sor-1-ajto-1:top"]);
  later(600);
  assert.equal(await rounds.finishIdle(QUIET), false); // still photographing
  await rounds.addPhoto(fakeBlob(), ["sor-1-ajto-1:bottom"]);
  later(899);
  assert.equal(await rounds.finishIdle(QUIET), false);
  later(2);
  assert.equal(await rounds.finishIdle(QUIET), true);
  assert.equal(await rounds.finishIdle(QUIET), false); // nothing open any more

  await rounds.pump();
  assert.deepEqual(drive.files.map((f) => f.name), ["foto-01.jpg", "foto-02.jpg", "done.json"]);
});

test("an empty round never closes into a done.json", async () => {
  const { drive, rounds, later } = setup();
  later(3600);
  assert.equal(await rounds.finishIdle(30_000), false);
  await rounds.pump();
  assert.equal(drive.folders.length + drive.files.length, 0);
});
