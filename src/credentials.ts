import { Entry } from "@napi-rs/keyring";
import { AxiError } from "axi-sdk-js";

export interface Credentials {
  email: string;
  token: string;
}

// Single keyring entry holds both values as JSON so they are retrieved together.
const SERVICE = "bitbucket-axi";
const ACCOUNT = "bitbucket-cloud";
// Separate entry for the optional Git HTTP credential helper token. Stored
// independently from the API token so a dedicated Git/app-password can be used.
const ACCOUNT_GIT = "bitbucket-cloud-git";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 320 && EMAIL_RE.test(email);
}

function entry(): Entry {
  return new Entry(SERVICE, ACCOUNT);
}

function gitEntry(): Entry {
  return new Entry(SERVICE, ACCOUNT_GIT);
}

export function loadCredentials(): Credentials | null {
  return readStored(entry());
}

export function saveCredentials(creds: Credentials): void {
  writeStored(entry(), creds);
}

export function clearCredentials(): void {
  removeStored(entry());
}

export function loadGitCredentials(): Credentials | null {
  return readStored(gitEntry());
}

export function saveGitCredentials(creds: Credentials): void {
  writeStored(gitEntry(), creds);
}

export function clearGitCredentials(): void {
  removeStored(gitEntry());
}

function readStored(e: Entry): Credentials | null {
  let raw: string | null;
  try {
    raw = e.getPassword();
  } catch (error) {
    if (isNoEntryError(error)) return null;
    throw keyringError(error);
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    typeof (parsed as { email?: unknown }).email === "string" &&
    typeof (parsed as { token?: unknown }).token === "string" &&
    (parsed as { email: string }).email &&
    (parsed as { token: string }).token
  ) {
    return {
      email: (parsed as { email: string }).email,
      token: (parsed as { token: string }).token,
    };
  }
  return null;
}

function writeStored(e: Entry, creds: Credentials): void {
  try {
    e.setPassword(JSON.stringify(creds));
  } catch (error) {
    throw keyringError(error);
  }
}

function removeStored(e: Entry): void {
  try {
    e.deleteCredential();
  } catch (error) {
    // deleteCredential returns false when no entry exists; a NoEntry-style throw
    // is also treated as success so `config clear` stays idempotent.
    if (!isNoEntryError(error)) throw keyringError(error);
  }
}

function isNoEntryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no (matching )?entry|not found|no credential/i.test(message);
}

function keyringError(_error: unknown): AxiError {
  // The native error is deliberately not surfaced: it may name the platform
  // backend and never helps the caller act. The structured error + suggestion
  // is the whole actionable surface.
  return new AxiError(
    "Could not access the operating system credential store",
    "CREDENTIAL_STORE_ERROR",
    [
      "Ensure the OS keychain is unlocked and accessible",
      "Run `bitbucket-axi config set` again",
    ],
  );
}
