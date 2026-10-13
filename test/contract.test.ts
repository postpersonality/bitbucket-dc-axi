import { readFileSync } from "node:fs";
import { AxiError } from "axi-sdk-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, JsonObject } from "../src/client.js";
import { loadToken } from "../src/credentials.js";
import { fakeServer, HEAD, OTHER, PR_URL, pullRequest, REPO, response, routes, run, setOrigin, stats, TOKEN, type FetchMock } from "./helpers.js";

vi.mock("node:child_process");
vi.mock("../src/credentials.js");

// The fields and exit codes firstmate reads (spec §7); changing them is a major version.
const BASE = "/rest/api/1.0/projects/PROJ/repos/repo/pull-requests";
const PR = `${BASE}/7`;
const STATS = `/rest/build-status/latest/commits/stats/${HEAD}`;
const STATE = /^(open|merged|declined)$/;
const COMMIT = /^[0-9a-f]{40}$/;

let fetchMock: FetchMock;
beforeEach(() => {
  vi.resetAllMocks();
  fetchMock = fakeServer();
  setOrigin();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// A server error that echoes the token, as a misbehaving proxy or server might.
const leaky = (status: number) =>
  response(status, { errors: [{ message: `rejected ${TOKEN}`, details: [`detail ${TOKEN}`] }] });

async function json(argv: string[]): Promise<{ result: Record<string, Json>; code: number; out: string }> {
  const { out, code } = await run([...argv, "--json"]);
  return { result: JSON.parse(out) as Record<string, Json>, code, out };
}

describe("firstmate fields", () => {
  it("pr view", async () => {
    routes(fetchMock, { [`GET ${PR}`]: response(200, pullRequest()), [`GET ${STATS}`]: response(200, stats()) });
    const { result, code } = await json(["pr", "view", PR_URL]);
    expect(code).toBe(0);
    expect(result["state"]).toMatch(STATE);
    expect(result["head"]).toMatch(COMMIT);
    expect(typeof result["draft"]).toBe("boolean");
    expect(result["url"]).toBe(PR_URL);
  });

  it("pr merge-check", async () => {
    routes(fetchMock, {
      [`GET ${PR}`]: response(200, pullRequest()),
      [`GET ${PR}/merge`]: response(200, { canMerge: true, conflicted: false, outcome: "CLEAN", vetoes: [] }),
      [`GET ${STATS}`]: response(200, stats({ successful: 1 })),
      [`GET ${PR}/blocker-comments`]: response(200, { values: [], isLastPage: true }),
    });
    const { result, code } = await json(["pr", "merge-check", PR_URL]);
    expect(code).toBe(0);
    expect(Array.isArray(result["blockers"])).toBe(true);
    expect((result["blockers"] as Json[]).every((item) => typeof item === "string")).toBe(true);
    expect(result["state"]).toMatch(STATE);
    expect(result["head"]).toMatch(COMMIT);
    expect(typeof result["draft"]).toBe("boolean");
  });

  it("pr merge", async () => {
    routes(fetchMock, {
      [`GET ${PR}`]: response(200, pullRequest()),
      [`POST ${PR}/merge`]: response(200, pullRequest({ state: "MERGED", version: 4 })),
    });
    const merged = await json(["pr", "merge", PR_URL, "--sha", HEAD]);
    expect(merged.code).toBe(0);
    expect(merged.result).toMatchObject({ state: "merged", head: HEAD });
    expect(typeof merged.result["already_merged"]).toBe("boolean");

    const moved = await json(["pr", "merge", PR_URL, "--sha", OTHER]);
    expect(moved.code).toBe(1);
    expect(moved.result["code"]).toBe("HEAD_MOVED");
    expect(moved.result["state"]).toMatch(STATE);
    expect(moved.result["head"]).toMatch(COMMIT);
  });

  it("pr create", async () => {
    routes(fetchMock, { [`POST ${BASE}`]: response(201, pullRequest()) });
    const { result, code } = await json(["pr", "create", "--title", "Add feature", "--source", "feature", "--destination", "main", "-R", REPO]);
    expect(code).toBe(0);
    expect(typeof result["id"]).toBe("number");
    expect(typeof result["url"]).toBe("string");
  });

  it("command -v finds the installed binary", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { bin: Record<string, string>; scripts: Record<string, string> };
    expect(pkg.bin["bitbucket-dc-axi"]).toBe("dist/bin/bitbucket-dc-axi.js");
    expect(pkg.scripts["build"]).toMatch(/chmod.*dist\/bin\/bitbucket-dc-axi\.js/);
    expect(readFileSync("bin/bitbucket-dc-axi.ts", "utf8").split("\n")[0]).toBe("#!/usr/bin/env node");
  });
});

interface ErrorCase {
  code: string;
  exit: number;
  argv: string[];
  setup: () => void;
  check?: (result: Record<string, Json>) => void;
}

const view = ["pr", "view", PR_URL];
const merge = (sha: string) => ["pr", "merge", PR_URL, "--sha", sha];
const onView = (reply: Response) => () => routes(fetchMock, { [`GET ${PR}`]: reply });
const onMerge = (pr: JsonObject, reply?: Response) => () =>
  routes(fetchMock, { [`GET ${PR}`]: response(200, pr), ...(reply ? { [`POST ${PR}/merge`]: reply } : {}) });

const CASES: ErrorCase[] = [
  { code: "NOT_FOUND", exit: 1, argv: view, setup: onView(leaky(404)) },
  { code: "MERGE_REJECTED", exit: 1, argv: merge(HEAD), setup: onMerge(pullRequest(), leaky(409)) },
  { code: "HEAD_MOVED", exit: 1, argv: merge(OTHER), setup: onMerge(pullRequest()) },
  {
    code: "MERGED_DIFFERENT_HEAD",
    exit: 1,
    argv: merge(HEAD),
    setup: onMerge(
      pullRequest(),
      response(200, pullRequest({ state: "MERGED", fromRef: { id: "refs/heads/feature", displayId: "feature", latestCommit: OTHER } })),
    ),
  },
  {
    code: "NOT_OPEN",
    exit: 1,
    argv: merge(HEAD),
    setup: onMerge(pullRequest({ state: "DECLINED", open: false, closed: true })),
    check: (result) => expect(result).toMatchObject({ state: "declined", head: HEAD }),
  },
  { code: "API_ERROR", exit: 1, argv: view, setup: onView(leaky(400)) },
  {
    code: "INTERNAL_ERROR",
    exit: 1,
    argv: view,
    setup: () => vi.mocked(loadToken).mockImplementation(() => { throw new Error("boom"); }),
    check: (result) => expect(JSON.stringify(result)).not.toContain("boom"),
  },
  {
    code: "VALIDATION_ERROR",
    exit: 2,
    argv: [...view, "--bogus"],
    setup: () => {},
    check: () => {
      expect(loadToken).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  },
  { code: "NOT_CONFIGURED", exit: 3, argv: view, setup: () => vi.mocked(loadToken).mockReturnValue(null) },
  {
    code: "CREDENTIAL_STORE_ERROR",
    exit: 3,
    argv: view,
    setup: () => vi.mocked(loadToken).mockImplementation(() => {
      throw new AxiError("Could not access the operating system credential store", "CREDENTIAL_STORE_ERROR", []);
    }),
  },
  { code: "REPO_NOT_RESOLVED", exit: 3, argv: ["pr", "view", "7"], setup: () => {} },
  { code: "AUTH_ERROR", exit: 4, argv: view, setup: onView(leaky(401)) },
  { code: "PERMISSION_ERROR", exit: 4, argv: view, setup: onView(leaky(403)) },
  {
    code: "NETWORK_ERROR",
    exit: 5,
    argv: view,
    setup: () => {
      vi.spyOn(AbortSignal, "timeout");
      fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    },
    check: () => expect(AbortSignal.timeout).toHaveBeenCalledWith(30000),
  },
  { code: "SERVER_ERROR", exit: 5, argv: view, setup: onView(leaky(500)) },
];

const SERVER_ECHO = new Set(["NOT_FOUND", "MERGE_REJECTED", "API_ERROR", "AUTH_ERROR", "PERMISSION_ERROR", "SERVER_ERROR"]);

describe("error codes", () => {
  it.each(CASES)("$code exits $exit", async ({ code, exit, argv, setup, check }) => {
    setup();
    const { result, code: actual, out } = await json(argv);
    expect(result["code"]).toBe(code);
    expect(actual).toBe(exit);
    expect(out).not.toContain(TOKEN);
    if (SERVER_ECHO.has(code)) expect(result["details"]).toEqual(["rejected [redacted]", "detail [redacted]"]);
    check?.(result);
  });

  it("covers every exit code once", () => {
    expect(new Set(CASES.map((item) => item.code)).size).toBe(15);
  });

  it("rejects a PR URL with -R before touching the credential store", async () => {
    const { result, code } = await json([...view, "-R", REPO]);
    expect(code).toBe(2);
    expect(result["code"]).toBe("VALIDATION_ERROR");
    expect(loadToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
