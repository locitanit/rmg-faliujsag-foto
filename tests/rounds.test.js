import assert from "node:assert/strict";
import { test } from "node:test";

import { DriveError } from "../drive.js";
import { MAX_PHOTO_BYTES, Rounds, newRoundId, photoName } from "../rounds.js";
import { FakeDrive, MemoryStore, fakeBlob } from "./helpers.js";

const NOW = new Date(2026, 9, 8, 10, 15, 0);

function setup() {
  const store = new MemoryStore();
  const drive = new FakeDrive();
  const rounds = new Rounds({
    store, drive, inboxFolderId: "inbox", now: () => NOW, random: () => 0.5,
  });
  return { store, drive, rounds };
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

test("the first photo starts a round; the photo waits locally until it is up", async () => {
  const { store, drive, rounds } = setup();

  await rounds.addPhoto(fakeBlob());
  let status = await rounds.status();
  assert.deepEqual([status.taken, status.uploaded, status.waiting], [1, 0, 1]);
  assert.equal(drive.files.length, 0);

  const result = await rounds.pump();
  assert.equal(result.state, "idle");
  assert.deepEqual(drive.folders, [{ id: "folder-1", name: "20261008-101500-i000", parentId: "inbox" }]);
  assert.deepEqual(drive.files.map((f) => [f.name, f.parentId]), [["foto-01.jpg", "folder-1"]]);
  assert.equal((await store.getPhotos()).length, 0); // nothing of the photo stays on the phone
  status = await rounds.status();
  assert.deepEqual([status.taken, status.uploaded, status.waiting], [1, 1, 0]);
});

test("more photos go into the same round folder", async () => {
  const { drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());
  await rounds.pump();
  await rounds.addPhoto(fakeBlob("image/heic"));
  await rounds.pump();

  assert.equal(drive.folders.length, 1);
  assert.deepEqual(drive.files.map((f) => f.name), ["foto-01.jpg", "foto-02.heic"]);
});

test("finishing writes done.json last, with counts only", async () => {
  const { drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());
  await rounds.addPhoto(fakeBlob());
  await rounds.finish();
  const result = await rounds.pump();

  assert.equal(result.state, "idle");
  assert.deepEqual(drive.files.map((f) => f.name), ["foto-01.jpg", "foto-02.jpg", "done.json"]);
  const done = JSON.parse(await drive.files[2].blob.text());
  assert.deepEqual(done, { schema: 1, photos: 2, finished_at: NOW.toISOString() });
  assert.equal((await rounds.status()).open, false);

  // The next photo starts a new round.
  await rounds.addPhoto(fakeBlob());
  await rounds.pump();
  assert.equal(drive.folders.length, 2);
});

test("finishing a round without photos uploads nothing", async () => {
  const { drive, rounds } = setup();
  await rounds.finish();
  await rounds.pump();
  assert.equal(drive.folders.length + drive.files.length, 0);
});

test("no network: the photo stays queued and goes up on the next try", async () => {
  const { store, drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());
  await rounds.addPhoto(fakeBlob());
  await rounds.finish();

  drive.failures.push(new DriveError("Nincs kapcsolat.", { retryable: true }));
  const first = await rounds.pump();
  assert.equal(first.state, "waiting");
  assert.equal(first.message, "Nincs kapcsolat.");
  assert.equal((await store.getPhotos()).length, 2);

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
  await rounds.pump();
  await rounds.addPhoto(fakeBlob());
  drive.failures.push(new DriveError("Nincs kapcsolat.", { retryable: true }));
  await rounds.pump();
  await rounds.pump();

  assert.equal(drive.folders.length, 1);
  assert.deepEqual(drive.files.map((f) => f.name), ["foto-01.jpg", "foto-02.jpg", "foto-03.jpg"]);
});

test("a permission problem stops the queue and is shown; an expired sign-in asks for sign-in", async () => {
  const { store, drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());

  drive.failures.push(new DriveError("Nincs jogosultságod.", { retryable: false }));
  assert.deepEqual(await rounds.pump(), { state: "blocked", message: "Nincs jogosultságod." });

  drive.failures.push(new DriveError("Lépj be újra.", { auth: true }));
  assert.deepEqual(await rounds.pump(), { state: "signin", message: "Lépj be újra." });
  assert.equal((await store.getPhotos()).length, 1);
});

test("the queue survives a restart of the app", async () => {
  const { store, drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());
  await rounds.pump();
  await rounds.addPhoto(fakeBlob());
  await rounds.finish();

  const reopened = new Rounds({ store, drive, inboxFolderId: "inbox", now: () => NOW });
  assert.equal((await reopened.status()).waiting, 1);
  await reopened.pump();
  assert.equal(drive.folders.length, 1);
  assert.deepEqual(drive.files.map((f) => f.name), ["foto-01.jpg", "foto-02.jpg", "done.json"]);
});

test("two pumps at once do not upload a photo twice", async () => {
  const { drive, rounds } = setup();
  await rounds.addPhoto(fakeBlob());
  await Promise.all([rounds.pump(), rounds.pump()]);
  assert.equal(drive.files.length, 1);
});

test("a file that is not a picture, or is too big for the processor, is refused", async () => {
  const { rounds } = setup();
  await assert.rejects(rounds.addPhoto(fakeBlob("application/pdf")), /kép/);
  await assert.rejects(rounds.addPhoto(fakeBlob("image/jpeg", MAX_PHOTO_BYTES + 1)), /nagy/);
  assert.equal((await rounds.status()).taken, 0);
});

test("a round remembers which pieces of the wall its photos ticked", async () => {
  const { rounds } = setup();
  await rounds.addPhoto(fakeBlob(), ["sor-1-ajto-1"]);
  await rounds.addPhoto(fakeBlob(), ["sor-1-ajto-2", "sor-1-ajto-1"]);
  await rounds.addPhoto(fakeBlob());
  assert.deepEqual((await rounds.status()).marks, ["sor-1-ajto-1", "sor-1-ajto-2"]);

  await rounds.finish();
  await rounds.pump();
  assert.deepEqual((await rounds.status()).marks, []); // a new round starts clean
});
