import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxiError } from "axi-sdk-js";

vi.mock("../src/credentials.js");

import { bitbucketRequest, BitbucketError, redact, validateToken } from "../src/client.js";
import { loadToken } from "../src/credentials.js";

const HOST = "bitbucket.example.com";
const TOKEN = "secret-token-123";
const fetchMock = vi.fn<typeof fetch>();

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(
    body === null ? null : typeof body === "string" ? body : JSON.stringify(body),
    { status, headers },
  );
}

async function failure(promise: Promise<unknown>): Promise<BitbucketError> {
  const error = await promise.then(
    () => { throw new Error("expected a rejection"); },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AxiError);
  return error as BitbucketError;
}

function init(): RequestInit {
  return fetchMock.mock.calls[0]![1]!;
}

function headers(): Record<string, string> {
  return init().headers as Record<string, string>;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.mocked(loadToken).mockReset();
  vi.mocked(loadToken).mockReturnValue(TOKEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("bitbucketRequest", () => {
  it("sends a bearer GET to the REST root", async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }));
    expect(await bitbucketRequest(HOST, "api/1.0/x", { query: { limit: 5, start: undefined } }))
      .toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`https://${HOST}/rest/api/1.0/x?limit=5`);
    expect(init().method).toBe("GET");
    expect(headers()["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(headers()["Content-Type"]).toBeUndefined();
    expect(vi.mocked(loadToken)).toHaveBeenCalledWith(HOST);
  });

  it("marks a POST as JSON and XSRF-exempt", async () => {
    fetchMock.mockResolvedValue(reply(200, null));
    expect(await bitbucketRequest(HOST, "api/1.0/x", { method: "POST", body: {} })).toBeNull();
    expect(headers()["Content-Type"]).toBe("application/json");
    expect(headers()["X-Atlassian-Token"]).toBe("no-check");
    expect(init().body).toBe("{}");
  });

  it("limits every request to 30 seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockImplementation(async () => reply(200, {}, { "X-AUSERNAME": "jdoe" }));
    await bitbucketRequest(HOST, "api/1.0/x");
    await validateToken(HOST, TOKEN);
    expect(timeout.mock.calls).toEqual([[30000], [30000]]);
  });

  it("refuses to call the server without a stored token", async () => {
    vi.mocked(loadToken).mockReturnValue(null);
    const error = await failure(bitbucketRequest(HOST, "api/1.0/x"));
    expect(error.code).toBe("NOT_CONFIGURED");
    expect(error.suggestions.join("\n")).toContain(`config set --host ${HOST}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 401 to AUTH_ERROR with the required permissions", async () => {
    fetchMock.mockResolvedValue(reply(401, { errors: [{ context: null, message: "m", exceptionName: "e" }] }));
    const error = await failure(bitbucketRequest(HOST, "api/1.0/x"));
    expect(error).toBeInstanceOf(BitbucketError);
    expect(error.code).toBe("AUTH_ERROR");
    expect(error.extras.status).toBe(401);
    expect(error.suggestions.join("\n")).toContain("REPO_READ");
    expect(error.suggestions.join("\n")).toContain("REPO_WRITE");
  });

  it.each([
    [403, "PERMISSION_ERROR"],
    [404, "NOT_FOUND"],
    [400, "API_ERROR"],
    [409, "API_ERROR"],
    [500, "SERVER_ERROR"],
    [503, "SERVER_ERROR"],
  ])("maps %i to %s without retrying", async (status, code) => {
    fetchMock.mockResolvedValue(reply(status, { errors: [{ context: null, message: "m", exceptionName: "e" }] }));
    const error = await failure(bitbucketRequest(HOST, "api/1.0/x"));
    expect(error.code).toBe(code);
    expect(error.extras.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads details from a swagger 10.0 error body", async () => {
    fetchMock.mockResolvedValue(reply(400, { errors: [{ context: null, message: "m", exceptionName: "e" }] }));
    const error = await failure(bitbucketRequest(HOST, "api/1.0/x"));
    expect(error.extras.details).toEqual(["m"]);
    expect(error.extras).not.toHaveProperty("vetoes");
  });

  it("appends errors[].details when the server sends them", async () => {
    fetchMock.mockResolvedValue(reply(400, { errors: [{ message: "m", details: ["d"] }] }));
    expect((await failure(bitbucketRequest(HOST, "api/1.0/x"))).extras.details).toEqual(["m", "d"]);
  });

  it("maps errors[].vetoes when the server sends them", async () => {
    fetchMock.mockResolvedValue(reply(409, {
      errors: [{ message: "x", vetoes: [{ summaryMessage: "s", detailedMessage: "d" }] }],
    }));
    expect((await failure(bitbucketRequest(HOST, "api/1.0/x"))).extras.vetoes).toEqual([
      { summary: "s", detail: "d" },
    ]);
  });

  it("omits details for a non-JSON error body", async () => {
    fetchMock.mockResolvedValue(reply(502, "<html>Bad gateway</html>"));
    const error = await failure(bitbucketRequest(HOST, "api/1.0/x"));
    expect(error.code).toBe("SERVER_ERROR");
    expect(error.extras).toEqual({ status: 502 });
  });

  it("maps a connection failure to NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect((await failure(bitbucketRequest(HOST, "api/1.0/x"))).code).toBe("NETWORK_ERROR");
  });

  it("keeps the fetch cause in NETWORK_ERROR, redacted", async () => {
    vi.stubEnv("HTTPS_PROXY", ""); vi.stubEnv("https_proxy", ""); vi.stubEnv("HTTP_PROXY", ""); vi.stubEnv("http_proxy", "");
    const cause = Object.assign(new Error(`connect ENETUNREACH ${TOKEN}`), { code: "ENETUNREACH" });
    fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause }));
    const error = await failure(bitbucketRequest(HOST, "api/1.0/x"));
    expect(error.message).toContain("ENETUNREACH: connect ENETUNREACH [redacted]");
    expect(error.message).not.toContain(TOKEN);
    expect(error.suggestions.join("\n")).not.toContain("NODE_USE_ENV_PROXY");
  });

  it("reports the innermost fetch cause in NETWORK_ERROR, redacted", async () => {
    const proxy = Object.assign(new Error(`Proxy response (502) !== 200 when HTTP Tunneling ${TOKEN}`), { code: "UND_ERR_ABORTED" });
    const aborted = Object.assign(new DOMException("Request was cancelled.", "AbortError"), { cause: proxy });
    fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause: aborted }));
    const error = await failure(bitbucketRequest(HOST, "api/1.0/x"));
    expect(error.message).toContain("UND_ERR_ABORTED: Proxy response (502) !== 200 when HTTP Tunneling [redacted]");
    expect(error.message).not.toContain(TOKEN);
  });

  it.each([
    [{ HTTPS_PROXY: "http://localhost:3128" }, true],
    [{ http_proxy: "http://localhost:3128" }, true],
    [{ HTTPS_PROXY: "http://localhost:3128", NODE_USE_ENV_PROXY: "1" }, false],
    [{}, false],
  ])("hints NODE_USE_ENV_PROXY for %j: %s", async (env, hinted) => {
    for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NODE_USE_ENV_PROXY"]) {
      vi.stubEnv(name, (env as Record<string, string>)[name] ?? "");
    }
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const help = (await failure(bitbucketRequest(HOST, "api/1.0/x"))).suggestions.join("\n");
    expect(help.includes("NODE_USE_ENV_PROXY=1")).toBe(hinted);
  });

  it("maps a timeout to NETWORK_ERROR naming 30 s", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const error = await failure(bitbucketRequest(HOST, "api/1.0/x"));
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toContain("30 s");
  });

  it("redacts server text in details", async () => {
    const message = `bad ${TOKEN}\nline\ttab ${"x".repeat(400)}`;
    fetchMock.mockResolvedValue(reply(400, { errors: [{ message }] }));
    const [detail] = (await failure(bitbucketRequest(HOST, "api/1.0/x"))).extras.details as string[];
    expect(detail).not.toContain(TOKEN);
    expect(detail).not.toMatch(/[\n\t\r]/);
    expect(detail!.length).toBeLessThanOrEqual(300);
  });
});

describe("redact", () => {
  it("masks a token that straddles the truncation boundary", () => {
    const result = redact(`${"a".repeat(295)}${TOKEN}`, TOKEN);
    expect(result).not.toContain(TOKEN);
    expect(result).not.toContain(TOKEN.slice(0, 5));
  });
});

describe("validateToken", () => {
  it("returns the user and server version", async () => {
    fetchMock.mockResolvedValue(reply(200, { version: "10.0.1" }, { "X-AUSERNAME": "jdoe" }));
    expect(await validateToken(HOST, "candidate")).toEqual({ user: "jdoe", version: "10.0.1" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`https://${HOST}/rest/api/1.0/application-properties`);
    expect(headers()["Authorization"]).toBe("Bearer candidate");
    expect(vi.mocked(loadToken)).not.toHaveBeenCalled();
  });

  it.each([["jdoe%40example.com", "jdoe@example.com"], ["jdoe%E0%A4%A", "jdoe%E0%A4%A"]])("decodes X-AUSERNAME %s", async (header, user) => {
    fetchMock.mockResolvedValue(reply(200, { version: "10.0.1" }, { "X-AUSERNAME": header }));
    expect((await validateToken(HOST, "candidate")).user).toBe(user);
  });

  it.each([[{}], [{ "X-AUSERNAME": "" }]])("rejects a reply without a user: %j", async (extra) => {
    fetchMock.mockResolvedValue(reply(200, { version: "10.0.1" }, extra));
    expect((await failure(validateToken(HOST, "candidate"))).code).toBe("AUTH_ERROR");
  });

  it("maps 401 to AUTH_ERROR", async () => {
    fetchMock.mockResolvedValue(reply(401, { errors: [{ message: "denied" }] }));
    expect((await failure(validateToken(HOST, "candidate"))).code).toBe("AUTH_ERROR");
  });

  it("redacts the candidate token from server text", async () => {
    fetchMock.mockResolvedValue(reply(500, { errors: [{ message: "boom candidate-token" }] }));
    const error = await failure(validateToken(HOST, "candidate-token"));
    expect(error.code).toBe("SERVER_ERROR");
    expect(JSON.stringify(error.extras.details)).not.toContain("candidate-token");
  });
});
