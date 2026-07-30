import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "@toon-format/toon";
import { AxiError } from "axi-sdk-js";

// Shared in-memory keyring mock. Tests reset and reprogram these per case so the
// real OS credential store is never touched.
const keyring = vi.hoisted(() => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deleteCredential: vi.fn(),
}));

vi.mock("@napi-rs/keyring", () => ({
  Entry: vi.fn(() => keyring),
}));

import { basicAuthHeader, bitbucketRequest, validateCredentials } from "../src/client.js";
import { configClear, configSet, configStatus, readTokenFromStdin } from "../src/commands.js";
import { clearCredentials, loadCredentials, saveCredentials } from "../src/credentials.js";

function response(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("credential store", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    keyring.getPassword.mockReset();
    keyring.setPassword.mockReset();
    keyring.deleteCredential.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("returns null when no credential is stored", () => {
    keyring.getPassword.mockReturnValue(null);
    expect(loadCredentials()).toBeNull();
  });

  it("returns null for a malformed stored entry instead of throwing", () => {
    keyring.getPassword.mockReturnValue("not-json");
    expect(loadCredentials()).toBeNull();
  });

  it("loads a stored email and token", () => {
    keyring.getPassword.mockReturnValue(JSON.stringify({ email: "you@example.com", token: "secret-token" }));
    expect(loadCredentials()).toEqual({ email: "you@example.com", token: "secret-token" });
  });

  it("stores both values as a single keychain entry", () => {
    saveCredentials({ email: "you@example.com", token: "secret-token" });
    expect(keyring.setPassword).toHaveBeenCalledWith(
      JSON.stringify({ email: "you@example.com", token: "secret-token" }),
    );
  });

  it("translates a keyring failure into a structured error without leaking the native error", () => {
    keyring.setPassword.mockImplementation(() => {
      throw new Error("secret-service: D-Bus connection failed\n    at native/stack.ts:1:1");
    });
    let caught: unknown;
    try {
      saveCredentials({ email: "you@example.com", token: "secret-token" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AxiError);
    expect((caught as AxiError).message).toBe("Could not access the operating system credential store");
    expect((caught as AxiError).code).toBe("CREDENTIAL_STORE_ERROR");
    expect((caught as AxiError).message).not.toContain("secret-service");
    expect((caught as AxiError).message).not.toContain("D-Bus");
    expect((caught as Error).stack ?? "").not.toContain("secret-token");
  });

  it("clearCredentials is idempotent when the entry is already absent", () => {
    keyring.deleteCredential.mockReturnValue(false);
    expect(() => clearCredentials()).not.toThrow();
    expect(keyring.deleteCredential).toHaveBeenCalled();
  });

  it("clearCredentials treats a NoEntry-style throw as success", () => {
    keyring.deleteCredential.mockImplementation(() => {
      throw new Error("No matching entry found");
    });
    expect(() => clearCredentials()).not.toThrow();
  });
});

describe("missing credentials prevent fetch", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    keyring.getPassword.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("makes no API call when no credential is stored", async () => {
    keyring.getPassword.mockReturnValue(null);
    await expect(bitbucketRequest("user")).rejects.toThrow("Bitbucket authentication is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("config set", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    keyring.setPassword.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("validates the token and stores the credential in the keychain", async () => {
    fetchMock.mockResolvedValue(response({ values: [{ email: "you@example.com", is_primary: true }] }));
    const output = await configSet(
      ["--email", "you@example.com", "--token-stdin"],
      async () => "secret-token",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.bitbucket.org/2.0/user/emails",
      expect.objectContaining({ method: "GET" }),
    );
    expect(keyring.setPassword).toHaveBeenCalledWith(
      JSON.stringify({ email: "you@example.com", token: "secret-token" }),
    );
    expect(output).toMatchObject({ config: { email: "you@example.com", status: "configured" } });
    expect(encode(output)).not.toContain("secret-token");
  });

  it("does not store the credential when Bitbucket rejects the token", async () => {
    fetchMock.mockResolvedValue(response({ error: { message: "bad credentials" } }, 401));
    await expect(
      configSet(["--email", "you@example.com", "--token-stdin"], async () => "bad-token"),
    ).rejects.toThrow("Bitbucket rejected the email or API token");
    expect(keyring.setPassword).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not store the credential when the email does not match the account", async () => {
    fetchMock.mockResolvedValue(response({ values: [{ email: "someone-else@example.com" }] }));
    await expect(
      configSet(["--email", "you@example.com", "--token-stdin"], async () => "tok"),
    ).rejects.toThrow("does not belong to this API token's account");
    expect(keyring.setPassword).not.toHaveBeenCalled();
  });

  it("requires --token-stdin and never accepts the token as an argument", async () => {
    await expect(
      configSet(["--email", "you@example.com"], async () => "tok"),
    ).rejects.toThrow("--token-stdin is required");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keyring.setPassword).not.toHaveBeenCalled();
  });

  it("fails clearly when the token read from stdin is empty", async () => {
    await expect(
      configSet(["--email", "you@example.com", "--token-stdin"], async () => ""),
    ).rejects.toThrow("no API token received on stdin");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keyring.setPassword).not.toHaveBeenCalled();
  });

  it("rejects an invalid email before any network or storage call", async () => {
    await expect(
      configSet(["--email", "not-an-email", "--token-stdin"], async () => "tok"),
    ).rejects.toThrow("invalid email");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keyring.setPassword).not.toHaveBeenCalled();
  });

  it("rejects a token on stdin that exceeds the bounded size", async () => {
    const stream = new PassThrough();
    stream.end(Buffer.alloc(9000, 97)); // 9000 'a' bytes > 8192 limit
    await expect(readTokenFromStdin(stream)).rejects.toThrow("too large");
  });
});

describe("config status", () => {
  beforeEach(() => keyring.getPassword.mockReset());

  it("reports the configured email and readiness, never the token", async () => {
    keyring.getPassword.mockReturnValue(JSON.stringify({ email: "you@example.com", token: "secret-token" }));
    const toon = encode(await configStatus([]));
    expect(toon).toContain("you@example.com");
    expect(toon).toContain("ready: true");
    expect(toon).not.toContain("secret-token");
  });

  it("reports not ready when no credential is configured", async () => {
    keyring.getPassword.mockReturnValue(null);
    const toon = encode(await configStatus([]));
    expect(toon).toContain("ready: false");
    expect(toon).not.toContain("you@example.com");
    expect(toon).toContain("config set");
  });
});

describe("config clear", () => {
  beforeEach(() => {
    keyring.getPassword.mockReset();
    keyring.deleteCredential.mockReset();
  });

  it("removes a stored credential", async () => {
    keyring.getPassword.mockReturnValue(JSON.stringify({ email: "you@example.com", token: "tok" }));
    keyring.deleteCredential.mockReturnValue(true);
    const output = await configClear([]);
    expect(output).toMatchObject({ config: { status: "cleared" } });
    expect(keyring.deleteCredential).toHaveBeenCalled();
  });

  it("is idempotent when the store is already empty", async () => {
    keyring.getPassword.mockReturnValue(null);
    keyring.deleteCredential.mockReturnValue(false);
    const output = await configClear([]);
    expect(output).toMatchObject({ config: { status: "already clear" } });
  });
});

describe("credential validation", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("constructs the Basic auth header as email:token base64 and never leaks the token", async () => {
    fetchMock.mockResolvedValue(response({ values: [{ email: "you@example.com" }] }));
    await validateCredentials("you@example.com", "secret-token");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      basicAuthHeader("you@example.com", "secret-token"),
    );
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      `Basic ${Buffer.from("you@example.com:secret-token").toString("base64")}`,
    );
  });

  it("accepts a token whose account owns the email", async () => {
    fetchMock.mockResolvedValue(response({ values: [{ email: "You@Example.com", is_primary: true }] }));
    await expect(validateCredentials("you@example.com", "tok")).resolves.toBeUndefined();
  });

  it("rejects a 401 without leaking the token in the error", async () => {
    fetchMock.mockResolvedValue(response({ error: { message: "bad secret-token" } }, 401));
    let caught: unknown;
    try {
      await validateCredentials("you@example.com", "secret-token");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AxiError);
    expect((caught as AxiError).code).toBe("AUTH_ERROR");
    expect((caught as AxiError).message).not.toContain("secret-token");
  });

  it("reports a missing scope on 403 with an actionable suggestion", async () => {
    fetchMock.mockResolvedValue(response({ error: { message: "forbidden" } }, 403));
    await expect(validateCredentials("you@example.com", "tok")).rejects.toThrow("lacks the scope");
  });

  it("basicAuthHeader encodes email:token as base64", () => {
    expect(basicAuthHeader("you@example.com", "secret-token")).toBe(
      `Basic ${Buffer.from("you@example.com:secret-token").toString("base64")}`,
    );
  });
});
