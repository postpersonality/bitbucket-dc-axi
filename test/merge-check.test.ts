import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calls, fakeServer, HEAD, page, PR_URL, pullRequest, REPO, response, routes, run, setOrigin, stats, type FetchMock } from "./helpers.js";
import type { Json, JsonObject } from "../src/client.js";

vi.mock("node:child_process");
vi.mock("../src/credentials.js");

const BASE = "/rest/api/1.0/projects/PROJ/repos/repo/pull-requests/7";
const CLEAN = { canMerge: true, conflicted: false, outcome: "CLEAN", vetoes: [] };

let fetchMock: FetchMock;
beforeEach(() => {
  vi.resetAllMocks();
  fetchMock = fakeServer();
  setOrigin();
});
afterEach(() => {
  expect(calls(fetchMock).filter((call) => call.method !== "GET")).toEqual([]);
  vi.unstubAllGlobals();
});

function server(options: { pr?: JsonObject; merge?: JsonObject; stats?: JsonObject; comments?: Json[] } = {}): void {
  routes(fetchMock, {
    [`GET ${BASE}`]: response(200, options.pr ?? pullRequest()),
    [`GET ${BASE}/merge`]: response(200, options.merge ?? CLEAN),
    [`GET /rest/build-status/latest/commits/stats/${HEAD}`]: response(200, options.stats ?? stats({ successful: 3 })),
    [`GET ${BASE}/blocker-comments`]: response(200, page(options.comments ?? [])),
  });
}

async function check(argv: string[] = ["7", "-R", REPO]): Promise<{ result: Record<string, Json>; code: number }> {
  const { out, code } = await run(["pr", "merge-check", ...argv, "--json"]);
  return { result: JSON.parse(out), code };
}

describe("pr merge-check", () => {
  it("reports a clean pull request", async () => {
    server();
    const { result, code } = await check();
    expect(code).toBe(0);
    expect(result).toEqual({
      id: 7,
      state: "open",
      draft: false,
      version: 3,
      head: HEAD,
      url: PR_URL,
      conflicted: false,
      outcome: "CLEAN",
      vetoes: [],
      builds: { successful: 3, failed: 0, inProgress: 0, cancelled: 0, unknown: 0 },
      open_blocker_comments: false,
      blockers: [],
    });
  });

  it("skips mergeability on a closed pull request", async () => {
    server({ pr: pullRequest({ state: "MERGED", open: false, closed: true }) });
    const { result, code } = await check();
    expect(code).toBe(0);
    expect(result).toMatchObject({ conflicted: null, outcome: null, vetoes: null });
    expect(result.blockers).toContain("not_open");
    expect(calls(fetchMock).map((call) => call.path)).not.toContain(`${BASE}/merge`);
  });

  it.each<[string, Parameters<typeof server>[0]]>([
    ["draft", { pr: pullRequest({ draft: true }) }],
    ["conflicted", { merge: { canMerge: false, conflicted: true, outcome: "CONFLICTED", vetoes: [] } }],
    ["mergeability_unknown", { merge: { canMerge: false, conflicted: false, outcome: "UNKNOWN", vetoes: [] } }],
  ])("reports only %s", async (blocker, options) => {
    server(options);
    expect((await check()).result.blockers).toEqual([blocker]);
  });

  it("reports vetoes", async () => {
    server({ merge: { canMerge: false, conflicted: false, outcome: "CLEAN", vetoes: [{ summaryMessage: "Needs approval", detailedMessage: "One approval required" }] } });
    const { result } = await check();
    expect(result.blockers).toEqual(["vetoed"]);
    expect(result.vetoes).toEqual([{ summary: "Needs approval", detail: "One approval required" }]);
  });

  it.each([stats(), stats({ successful: 2, failed: 1 }), stats({ successful: 2, inProgress: 1 })])("blocks on builds %j", async (counts) => {
    server({ stats: counts });
    expect((await check()).result.blockers).toEqual(["builds"]);
  });

  it("blocks on open blocker comments", async () => {
    server({ comments: [{ id: 1, text: "Fix this", severity: "BLOCKER", state: "OPEN" }] });
    const { result } = await check();
    expect(result.blockers).toEqual(["open_blocker_comments"]);
    expect(result.open_blocker_comments).toBe(true);
    expect(calls(fetchMock).find((call) => call.path === `${BASE}/blocker-comments`)?.query).toEqual({ states: "OPEN", limit: "1" });
  });

  it("lists every blocker in order", async () => {
    server({
      pr: pullRequest({ draft: true }),
      merge: { canMerge: false, conflicted: true, outcome: "CONFLICTED", vetoes: [{ summaryMessage: "s", detailedMessage: "d" }] },
      stats: stats(),
      comments: [{ id: 1 }],
    });
    expect((await check()).result.blockers).toEqual(["draft", "conflicted", "vetoed", "builds", "open_blocker_comments"]);
  });

  it("answers the contract fields by URL", async () => {
    server();
    const { result } = await check([PR_URL]);
    expect(Array.isArray(result.blockers)).toBe(true);
    expect(result.state).toBe("open");
    expect(typeof result.draft).toBe("boolean");
    expect(result.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("needs a repository for a number", async () => {
    const { out, code } = await run(["pr", "merge-check", "7"]);
    expect(out).toContain("REPO_NOT_RESOLVED");
    expect(code).toBe(3);
  });
});
