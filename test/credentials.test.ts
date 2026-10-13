import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxiError } from "axi-sdk-js";

const keyring = vi.hoisted(() => ({
  Entry: vi.fn(),
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deleteCredential: vi.fn(),
}));

vi.mock("@napi-rs/keyring", () => ({ Entry: keyring.Entry }));

import { clearToken, loadToken, saveToken } from "../src/credentials.js";

function storeError(fn: () => unknown): AxiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AxiError);
    expect((error as AxiError).code).toBe("CREDENTIAL_STORE_ERROR");
    return error as AxiError;
  }
  throw new Error("expected CREDENTIAL_STORE_ERROR");
}

describe("credentials", () => {
  beforeEach(() => {
    keyring.Entry.mockReset();
    keyring.Entry.mockImplementation(() => ({
      getPassword: keyring.getPassword,
      setPassword: keyring.setPassword,
      deleteCredential: keyring.deleteCredential,
    }));
    keyring.getPassword.mockReset();
    keyring.setPassword.mockReset();
    keyring.deleteCredential.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reads the host entry from Secret Service", () => {
    keyring.getPassword.mockReturnValue("stored-token");
    expect(loadToken("h")).toBe("stored-token");
    expect(keyring.Entry).toHaveBeenCalledWith("bitbucket-dc-axi", "h", {
      linux: { store: "secret-service" },
    });
  });

  it("returns null when there is no entry", () => {
    keyring.getPassword.mockReturnValue(null);
    expect(loadToken("h")).toBeNull();
  });

  it("does not mistake an unavailable store for a missing entry", () => {
    keyring.getPassword.mockImplementation(() => {
      throw new Error("Secret Service not found");
    });
    const help = storeError(() => loadToken("h")).suggestions.join("\n");
    expect(help).toContain("GNOME Keyring");
    expect(help).toContain("KWallet");
    expect(help).toContain("config set --host h");
  });

  it("reports a failing Entry constructor", () => {
    keyring.Entry.mockImplementation(() => {
      throw new Error("platform failure");
    });
    storeError(() => loadToken("h"));
  });

  it("saves the token and never echoes it on failure", () => {
    saveToken("h", "t");
    expect(keyring.setPassword).toHaveBeenCalledWith("t");

    keyring.setPassword.mockImplementation(() => {
      throw new Error("cannot store secret-token-123");
    });
    const error = storeError(() => saveToken("h", "secret-token-123"));
    expect(error.message).not.toContain("secret-token-123");
    expect(error.suggestions.join("\n")).not.toContain("secret-token-123");
  });

  it("reports whether clear removed an entry", () => {
    keyring.deleteCredential.mockReturnValue(true);
    expect(clearToken("h")).toBe(true);
    keyring.deleteCredential.mockReturnValue(false);
    expect(clearToken("h")).toBe(false);
    keyring.deleteCredential.mockImplementation(() => {
      throw new Error("locked");
    });
    storeError(() => clearToken("h"));
  });

  it("ignores token environment variables", () => {
    vi.stubEnv("BITBUCKET_TOKEN", "env-token");
    keyring.getPassword.mockReturnValue(null);
    expect(loadToken("h")).toBeNull();
  });
});
