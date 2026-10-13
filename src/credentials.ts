import { Entry } from "@napi-rs/keyring";
import { AxiError } from "axi-sdk-js";

// One keychain entry per Bitbucket host; the value is the personal access token.
const SERVICE = "bitbucket-dc-axi";

export function loadToken(host: string): string | null {
  return withStore(host, (entry) => entry.getPassword());
}

export function saveToken(host: string, token: string): void {
  withStore(host, (entry) => entry.setPassword(token));
}

// `true` when an entry existed and was removed.
export function clearToken(host: string): boolean {
  return withStore(host, (entry) => entry.deleteCredential());
}

function withStore<T>(host: string, action: (entry: Entry) => T): T {
  try {
    // Pinned to Secret Service: keyutils would silently lose the token on reboot.
    return action(new Entry(SERVICE, host, { linux: { store: "secret-service" } }));
  } catch {
    // The native message is never surfaced: it may echo stored data and does not
    // help the caller act.
    throw new AxiError(
      "Could not access the operating system credential store",
      "CREDENTIAL_STORE_ERROR",
      [
        "Ensure a Secret Service keyring (GNOME Keyring or KWallet) is running and unlocked",
        `Run \`bitbucket-dc-axi config set --host ${host}\``,
      ],
    );
  }
}
