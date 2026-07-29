import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "@toon-format/toon";
import { apiCommand, pipelineCommand, prCommand, repoCommand } from "../src/commands.js";
import type { RepoContext } from "../src/context.js";

const ctx: RepoContext = {
  workspace: "acme",
  repo: "widgets",
  nwo: "acme/widgets",
  source: "flag",
};

function response(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Bitbucket commands", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env["ATLASSIAN_EMAIL"] = "agent@example.com";
    process.env["BITBUCKET_API_TOKEN"] = "test-token";
  });

  afterEach(() => {
    delete process.env["ATLASSIAN_EMAIL"];
    delete process.env["BITBUCKET_API_TOKEN"];
    vi.unstubAllGlobals();
  });

  it("validates missing authentication before making a request", async () => {
    delete process.env["BITBUCKET_API_TOKEN"];
    await expect(repoCommand(["view"], ctx)).rejects.toThrow(
      "Bitbucket authentication is not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("translates an HTTP authentication failure", async () => {
    fetchMock.mockResolvedValue(response({ error: { message: "bad credentials" } }, 401));
    await expect(repoCommand(["view"], ctx)).rejects.toThrow("Bitbucket authentication failed");
  });

  it("prints a definitive empty pull request list", async () => {
    fetchMock.mockResolvedValue(response({ size: 0, pagelen: 30, values: [] }));
    const output = await prCommand(["list"], ctx);
    const toon = encode(output);
    expect(toon).toContain("0 open pull requests found in acme/widgets");
    expect(toon).toContain("pull_requests: []");
  });

  it("renders representative pull request detail", async () => {
    fetchMock.mockResolvedValue(response({
      id: 42,
      title: "Fix auth",
      state: "OPEN",
      author: { display_name: "Ada" },
      source: { branch: { name: "fix/auth" } },
      destination: { branch: { name: "main" } },
      description: "Details",
      comment_count: 2,
      links: { html: { href: "https://bitbucket.org/acme/widgets/pull-requests/42" } },
    }));
    const output = await prCommand(["view", "42"], ctx);
    expect(output["pull_request"]).toMatchObject({
      id: 42,
      title: "Fix auth",
      author: "Ada",
      source: "fix/auth",
      destination: "main",
    });
  });

  it("creates a pull request with the documented REST body", async () => {
    fetchMock.mockResolvedValue(response({
      id: 7,
      title: "Fix auth",
      state: "OPEN",
      source: { branch: { name: "fix/auth" } },
      destination: { branch: { name: "main" } },
    }, 201));
    const output = await prCommand([
      "create",
      "--title", "Fix auth",
      "--source", "fix/auth",
      "--destination", "main",
      "--close-source",
    ], ctx);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "Fix auth",
      source: { branch: { name: "fix/auth" } },
      destination: { branch: { name: "main" } },
      close_source_branch: true,
    });
    expect(output["pull_request"]).toMatchObject({ id: 7, state: "open" });
  });

  it("renders a compact pipeline list", async () => {
    fetchMock.mockResolvedValue(response({ size: 1, values: [{
      uuid: "{12345678-abcd}",
      build_number: 12,
      state: { result: { name: "SUCCESSFUL" } },
      target: { ref_name: "main", commit: { hash: "abcdef1234567890" } },
      created_on: "2026-01-01T00:00:00Z",
    }] }));
    const output = await pipelineCommand(["list", "--fields", "commit"], ctx);
    expect((output["pipelines"] as unknown[])[0]).toMatchObject({
      build: 12,
      state: "successful",
      branch: "main",
      uuid: "{12345678-abcd}",
      commit: "abcdef123456",
    });
  });

  it("keeps raw API requests on api.bitbucket.org", async () => {
    fetchMock.mockResolvedValue(response({ ok: true }));
    await apiCommand(["/repositories/{workspace}/{repo}"], ctx);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.bitbucket.org/2.0/repositories/acme/widgets");
  });
});
