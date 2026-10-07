// The few Google Drive calls the app needs: make a folder, upload a file.
// Every request has a timeout; rate limits, server errors and a missing network are
// retried a bounded number of times; a sign-in or permission problem never is.
// Messages are Hungarian and safe to show: no token, no file name.

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_ATTEMPTS = 4;
const FIRST_WAIT_MS = 1000;
const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

export class DriveError extends Error {
  constructor(message, { retryable = false, auth = false } = {}) {
    super(message);
    this.name = "DriveError";
    this.retryable = retryable; // worth trying again later, as it is
    this.auth = auth; // the user has to sign in again
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reasonOf(response) {
  try {
    const body = await response.json();
    return body?.error?.errors?.[0]?.reason ?? "";
  } catch {
    return "";
  }
}

export function createDrive({
  fetchFn = (...args) => fetch(...args),
  getToken,
  sleep = defaultSleep,
  timeoutMs = 60_000,
  uploadTimeoutMs = 300_000,
}) {
  async function request(url, options, timeout = timeoutMs) {
    for (let attempt = 1; ; attempt++) {
      const last = attempt === MAX_ATTEMPTS;
      const token = await getToken(); // throws a DriveError(auth) when there is none
      let response;
      try {
        response = await fetchFn(url, {
          ...options,
          headers: { ...options.headers, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeout),
        });
      } catch {
        // No network, or the timeout ran out.
        if (last) {
          throw new DriveError(
            "Most nincs kapcsolat a Google Drive-val. A fotók a telefonon várnak, és maguktól felmennek, amint lesz net.",
            { retryable: true },
          );
        }
        await sleep(FIRST_WAIT_MS * 2 ** (attempt - 1));
        continue;
      }
      if (response.ok) return response;

      if (response.status === 401) {
        throw new DriveError("Lejárt a belépésed. Lépj be újra, és a feltöltés folytatódik.", {
          auth: true,
        });
      }
      const reason = response.status === 403 ? await reasonOf(response) : "";
      const busy =
        response.status === 429 || response.status >= 500 || RATE_LIMIT_REASONS.has(reason);
      if (busy) {
        if (last) {
          throw new DriveError(
            "A Google Drive most túlterhelt. A fotók a telefonon várnak, a feltöltés később magától folytatódik.",
            { retryable: true },
          );
        }
        await sleep(FIRST_WAIT_MS * 2 ** (attempt - 1));
        continue;
      }
      if (response.status === 403) {
        throw new DriveError(
          "Nincs jogosultságod feltölteni a faliújság mappájába. Kérd meg a faliújság gazdáját, hogy adjon hozzá a „beküldés” meghajtóhoz – és az iskolai fiókoddal lépj be.",
        );
      }
      if (response.status === 404) {
        throw new DriveError(
          "A faliújság beküldő mappája nem érhető el ezzel a fiókkal. Az iskolai fiókoddal léptél be? Ha igen, szólj a faliújság gazdájának.",
        );
      }
      throw new DriveError(`A Google Drive hibát jelzett (${response.status}). Próbáld újra később.`);
    }
  }

  const json = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });

  /** Remote scope: what was made must sit in the folder we asked for. */
  function checkParent(meta, parentId) {
    if (!meta?.id || !Array.isArray(meta.parents) || !meta.parents.includes(parentId)) {
      throw new DriveError("A feltöltés nem a faliújság mappájába került, ezért leállítottam.");
    }
    return meta.id;
  }

  return {
    async createFolder(name, parentId) {
      const url = `${API}?supportsAllDrives=true&fields=id,parents`;
      const response = await request(
        url,
        json({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      );
      return checkParent(await response.json(), parentId);
    },

    /** Resumable upload in one piece; a broken upload simply starts again. */
    async uploadFile(name, blob, parentId) {
      const start = `${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,parents`;
      const init = json({ name, parents: [parentId] });
      init.headers["X-Upload-Content-Type"] = blob.type || "application/octet-stream";
      const session = (await request(start, init)).headers.get("location");
      if (!session) {
        throw new DriveError("A Google Drive nem adott feltöltési címet. Próbáld újra később.", {
          retryable: true,
        });
      }
      const sent = await request(session, { method: "PUT", headers: {}, body: blob }, uploadTimeoutMs);
      return checkParent(await sent.json(), parentId);
    },
  };
}
