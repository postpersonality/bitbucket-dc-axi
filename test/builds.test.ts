import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStats, buildSummary } from "../src/commands/builds.js";
import { loadToken } from "../src/credentials.js";
import { calls, fakeServer, HEAD, HOST, page, REPO, response, routes, run, setOrigin, stats, type FetchMock } from "./helpers.js";

vi.mock("node:child_process");
vi.mock("../src/credentials.js");

const LIST = `GET /rest/build-status/latest/commits/${HEAD}`;
const STATS = `GET /rest/build-status/latest/commits/stats/${HEAD}`;
const build = (key: string, state = "SUCCESSFUL") => ({
  key,
  name: `Build ${key}`,
  state,
  url: `https://ci.example.com/${key}`,
  dateAdded: Date.UTC(2026, 9, 12),
});

let fetchMock: FetchMock;
beforeEach(() => {
  vi.resetAllMocks();
  fetchMock = fakeServer();
  setOrigin();
});
afterEach(() => vi.unstubAllGlobals());

describe("summary", () => {
  it("defaults missing counters to zero", async () => {
    routes(fetchMock, { [STATS]: response(200, { successful: 2 }) });
    expect(await buildStats(HOST, HEAD)).toEqual({ successful: 2, failed: 0, inProgress: 0, cancelled: 0, unknown: 0 });
  });

  it("summarises counts", () => {
    const zero = { successful: 0, failed: 0, inProgress: 0, cancelled: 0, unknown: 0 };
    expect(buildSummary(zero)).toBe("no builds");
    expect(buildSummary({ ...zero, successful: 2, inProgress: 1 })).toBe("2/3 passed, 1 running");
    expect(buildSummary({ successful: 1, failed: 2, inProgress: 3, cancelled: 4, unknown: 5 })).toBe(
      "1/15 passed, 2 failed, 3 running, 4 cancelled, 5 unknown",
    );
  });
});

describe("builds command", () => {
  it("lists builds and the summary", async () => {
    routes(fetchMock, {
      [LIST]: response(200, page([build("a"), build("b", "INPROGRESS")])),
      [STATS]: response(200, stats({ successful: 1, inProgress: 1 })),
    });
    const { out, code } = await run(["builds", HEAD, "-R", REPO, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      commit: HEAD,
      builds: [
        { key: "a", name: "Build a", state: "SUCCESSFUL", url: "https://ci.example.com/a" },
        { key: "b", name: "Build b", state: "INPROGRESS", url: "https://ci.example.com/b" },
      ],
      summary: "1/2 passed, 1 running",
    });
    expect(calls(fetchMock).map((call) => call.path).sort()).toEqual([LIST.slice(4), STATS.slice(4)].sort());
  });

  it("lowercases the commit", async () => {
    routes(fetchMock, { [LIST]: response(200, page([])), [STATS]: response(200, stats()) });
    expect((await run(["builds", HEAD.toUpperCase(), "-R", REPO])).code).toBe(0);
    for (const call of calls(fetchMock)) expect(call.path).toContain(HEAD);
  });

  it("follows pages", async () => {
    routes(fetchMock, {
      [LIST]: (url) =>
        url.searchParams.get("start") === "0"
          ? response(200, page([build("a")], { isLastPage: false, nextPageStart: 100 }))
          : response(200, page([build("b")])),
      [STATS]: response(200, stats({ successful: 2 })),
    });
    const { out } = await run(["builds", HEAD, "-R", REPO, "--json"]);
    expect(JSON.parse(out).builds).toHaveLength(2);
    expect(calls(fetchMock).filter((call) => call.path === LIST.slice(4)).map((call) => call.query)).toEqual([
      { limit: "100", start: "0" },
      { limit: "100", start: "100" },
    ]);
  });

  it("reports no builds", async () => {
    routes(fetchMock, { [LIST]: response(200, page([])), [STATS]: response(200, stats()) });
    const { out } = await run(["builds", HEAD, "-R", REPO, "--json"]);
    expect(JSON.parse(out)).toMatchObject({ builds: [], summary: "no builds" });
  });

  it.each([[["abc123", "-R", REPO]], [["-R", REPO]], [["abc123"]]])("rejects %j before the network", async (args) => {
    const { out, code } = await run(["builds", ...args]);
    expect(out).toContain("VALIDATION_ERROR");
    expect(code).toBe(2);
    expect(loadToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs a repository", async () => {
    const { out, code } = await run(["builds", HEAD]);
    expect(out).toContain("REPO_NOT_RESOLVED");
    expect(code).toBe(3);
  });
});
