// The only file to fill in before publishing. Nothing here is a secret (a web OAuth client
// id is public by design, and a folder id only works for those the folder is shared with) –
// but there is NO client secret in a web app: never put one here.

export const CONFIG = {
  // Google Cloud → the "RMG Tools" (Internal) project → Credentials → OAuth client ID →
  // "Web application". Authorised JavaScript origin: the address this page is served from.
  clientId: "",

  // The id of the `faliujsag/bejovo` folder on the "RMG Tools – beküldés" shared drive
  // (open the folder in Drive: the last part of the address).
  inboxFolderId: "",

  // `drive.file`: the app only reaches what it uploaded itself. If the first live try says
  // the inbox folder cannot be reached (W1 in the plan), the fallback is
  // "https://www.googleapis.com/auth/drive" – a far wider permission, decide it knowingly.
  scope: "https://www.googleapis.com/auth/drive.file",
};
