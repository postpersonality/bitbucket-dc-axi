import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, JsonObject } from "../src/client.js";
import { loadToken } from "../src/credentials.js";
import { calls, fakeServer, HEAD, OTHER, PR_URL, pullRequest, REPO, response, routes, run, setOrigin, TOKEN, type FetchMock } from "./helpers.js";

vi.mock("node:child_process");
vi.mock("../src/credentials.js");

const BASE = "/rest/api/1.0/projects/PROJ/repos/repo/pull-requests/7";

let fetchMock: FetchMock;
beforeEach(() => {
  vi.resetAllMocks();
  fetchMock = fakeServer();
  setOrigin();
});
afterEach(() => vi.unstubAllGlobals());

function server(pr: JsonObject, merged: Response = response(200, pullRequest({ state: "MERGED", version: 4 }))): void {
  routes(fetchMock, { [`GET ${BASE}`]: response(200, pr), [`POST ${BASE}/merge`]: merged });
}

async function merge(sha: string, target = "7"): Promise<{ result: Record<string, Json>; code: number }> {
  const { out, code } = await run(["pr", "merge", target, ...(target === "7" ? ["-R", REPO] : []), "--sha", sha, "--json"]);
  return { result: JSON.parse(out), code };
}

const posts = () => calls(fetchMock).filter((call) => call.method === "POST");

describe("pr merge", () => {
  it("merges the verified head", async () => {
    server(pullRequest());
    const { result, code } = await merge(HEAD);
    expect(code).toBe(0);
    expect(result).toEqual({ id: 7, state: "merged", head: HEAD, url: PR_URL, already_merged: false });
    expect(posts()).toEqual([expect.objectContaining({ path: `${BASE}/merge`, query: { version: "3" }, body: {} })]);
  });

  it("refuses a moved head", async () => {
    server(pullRequest());
    const { result, code } = await merge(OTHER);
    expect(result).toMatchObject({ code: "HEAD_MOVED", state: "open", head: HEAD, sha: OTHER });
    expect(code).toBe(1);
    expect(posts()).toEqual([]);
  });

  it("compares commits case-insensitively", async () => {
    server(pullRequest());
    expect((await merge(HEAD.toUpperCase())).code).toBe(0);
    expect(posts()).toHaveLength(1);
  });

  it("treats a merge at the same head as done", async () => {
    server(pullRequest({ state: "MERGED" }));
    const { result, code } = await merge(HEAD);
    expect(result).toMatchObject({ state: "merged", head: HEAD, already_merged: true });
    expect(code).toBe(0);
    expect(posts()).toEqual([]);
  });

  it.each<[string, JsonObject, JsonObject]>([
    ["merged at another head", pullRequest({ state: "MERGED", fromRef: { displayId: "feature", latestCommit: OTHER } }), { state: "merged", head: OTHER, sha: HEAD }],
    ["declined", pullRequest({ state: "DECLINED" }), { state: "declined", head: HEAD, sha: HEAD }],
  ])("refuses a pull request %s", async (_case, pr, fields) => {
    server(pr);
    const { result, code } = await merge(HEAD);
    expect(result).toMatchObject({ code: "NOT_OPEN", ...fields });
    expect(code).toBe(1);
    expect(posts()).toEqual([]);
  });

  it("reports a 409 from the swagger schema as MERGE_REJECTED", async () => {
    server(pullRequest(), response(409, { errors: [{ context: null, message: "The pull request has unresolved vetoes", exceptionName: "PullRequestMergeVetoedException" }] }));
    const { result, code } = await merge(HEAD);
    expect(result).toMatchObject({ code: "MERGE_REJECTED", status: 409, details: ["The pull request has unresolved vetoes"] });
    expect(result).not.toHaveProperty("vetoes");
    expect(code).toBe(1);
  });

  it("carries server vetoes on MERGE_REJECTED", async () => {
    server(pullRequest(), response(409, { errors: [{ message: "Vetoed", vetoes: [{ summaryMessage: "Needs approval", detailedMessage: "One approval required" }] }] }));
    const { result } = await merge(HEAD);
    expect(result).toMatchObject({ code: "MERGE_REJECTED", vetoes: [{ summary: "Needs approval", detail: "One approval required" }] });
  });

  it("detects a merge at a different head", async () => {
    server(pullRequest(), response(200, pullRequest({ state: "MERGED", fromRef: { displayId: "feature", latestCommit: OTHER } })));
    const { result, code } = await merge(HEAD);
    expect(result).toMatchObject({ code: "MERGED_DIFFERENT_HEAD", head: OTHER, sha: HEAD });
    expect(code).toBe(1);
  });

  it("maps a 401 on merge to AUTH_ERROR", async () => {
    server(pullRequest(), response(401, { errors: [{ message: "You are not permitted to merge" }] }));
    const { result, code } = await merge(HEAD);
    expect(result).toMatchObject({ code: "AUTH_ERROR", details: ["You are not permitted to merge"] });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(code).toBe(4);
  });

  it.each([[["7", "-R", REPO]], [["7", "-R", REPO, "--sha", "abc123"]], [["7", "--sha", "abc123"]]])("rejects %j before keychain and network", async (args) => {
    const { out, code } = await run(["pr", "merge", ...args]);
    expect(out).toContain("VALIDATION_ERROR");
    expect(code).toBe(2);
    expect(loadToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers the contract fields by URL", async () => {
    server(pullRequest());
    const { result } = await merge(HEAD, PR_URL);
    expect(result).toMatchObject({ state: "merged", head: HEAD, already_merged: false });
  });
});
