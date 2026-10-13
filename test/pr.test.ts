import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadToken } from "../src/credentials.js";
import { calls, fakeServer, HEAD, page, PR_URL, pullRequest, REPO, response, routes, run, setOrigin, stats, TOKEN, type FetchMock } from "./helpers.js";

vi.mock("node:child_process");
vi.mock("../src/credentials.js");

const BASE = "/rest/api/1.0/projects/PROJ/repos/repo";
const LIST = `GET ${BASE}/pull-requests`;
const PR = `GET ${BASE}/pull-requests/7`;
const STATS = `GET /rest/build-status/latest/commits/stats/${HEAD}`;
const CREATE = `POST ${BASE}/pull-requests`;
const DEFAULT_BRANCH = `GET ${BASE}/default-branch`;

let fetchMock: FetchMock;
beforeEach(() => {
  vi.resetAllMocks();
  fetchMock = fakeServer();
  setOrigin();
});
afterEach(() => vi.unstubAllGlobals());

describe("pr list", () => {
  it("lists open pull requests by default", async () => {
    routes(fetchMock, { [LIST]: response(200, page([pullRequest()])) });
    const { out, code } = await run(["pr", "list", "-R", REPO, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out).pull_requests).toEqual([{ id: 7, title: "Add feature", state: "open", author: "Jane Doe" }]);
    expect(calls(fetchMock)[0]!.query).toEqual({ state: "OPEN", limit: "30", order: "NEWEST" });
  });

  it("applies state, limit and fields", async () => {
    routes(fetchMock, { [LIST]: response(200, page([pullRequest({ draft: true })])) });
    const { out } = await run(["pr", "list", "-R", REPO, "--state", "all", "--limit", "5", "--fields", "url,draft,created", "--json"]);
    expect(calls(fetchMock)[0]!.query).toMatchObject({ state: "ALL", limit: "5" });
    expect(JSON.parse(out).pull_requests[0]).toMatchObject({ url: PR_URL, draft: true, created: "2026-10-12T08:30:00.000Z" });
  });

  it.each([[["--state", "superseded"]], [["--limit", "0"]], [["--fields", "bogus"]], [["--repo", REPO]]])("rejects %j with help", async (flags) => {
    const { out, code } = await run(["pr", "list", "-R", REPO, ...flags, "--json"]);
    expect(JSON.parse(out).help?.length).toBeGreaterThan(0);
    expect(code).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["git@github.com:o/r.git", "https://github.com/o/r.git"])("asks to configure the host of %s", async (origin) => {
    setOrigin(origin);
    vi.mocked(loadToken).mockReturnValue(null);
    const { out, code } = await run(["pr", "list"]);
    expect(out).toContain("NOT_CONFIGURED");
    expect(code).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unresolved repository on a configured foreign host", async () => {
    setOrigin("https://github.com/o/r.git");
    const { out, code } = await run(["pr", "list"]);
    expect(out).toContain("REPO_NOT_RESOLVED");
    expect(code).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("pr view", () => {
  beforeEach(() => routes(fetchMock, { [PR]: response(200, pullRequest()), [STATS]: response(200, stats({ successful: 2, inProgress: 1 })) }));

  const expected = {
    id: 7,
    title: "Add feature",
    state: "open",
    draft: false,
    author: "Jane Doe",
    source: "feature",
    destination: "main",
    head: HEAD,
    url: PR_URL,
    description: "Implements the feature",
    builds: "2/3 passed, 1 running",
  };

  it("shows a pull request with its build summary", async () => {
    const { out, code } = await run(["pr", "view", "7", "-R", REPO, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual(expected);
  });

  it.each([PR_URL, `${PR_URL}/diff`])("reads the repository from %s", async (url) => {
    const { out } = await run(["pr", "view", url, "--json"]);
    expect(JSON.parse(out)).toEqual(expected);
  });

  it("prefers the URL over origin", async () => {
    setOrigin("ssh://git@bitbucket.example.com:7999/other/repo.git");
    expect((await run(["pr", "view", PR_URL])).code).toBe(0);
    expect(calls(fetchMock)[0]!.path).toBe(`${BASE}/pull-requests/7`);
  });

  it("rejects a URL with -R", async () => {
    expect((await run(["pr", "view", PR_URL, "-R", REPO])).code).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a missing draft field as not draft", async () => {
    const { draft: _draft, ...pr89 } = pullRequest();
    routes(fetchMock, { [PR]: response(200, pr89), [STATS]: response(200, stats()) });
    expect(JSON.parse((await run(["pr", "view", "7", "-R", REPO, "--json"])).out).draft).toBe(false);
  });

  it("truncates long descriptions unless --full", async () => {
    const description = "d".repeat(800);
    routes(fetchMock, { [PR]: response(200, pullRequest({ description })), [STATS]: response(200, stats()) });
    const short = JSON.parse((await run(["pr", "view", "7", "-R", REPO, "--json"])).out);
    expect(short.description.startsWith(`${"d".repeat(700)}… (truncated, 800 chars total)`)).toBe(true);
    expect(short.help).toEqual(["Run `bitbucket-dc-axi pr view 7 -R bitbucket.example.com/PROJ/repo --full`"]);
    const full = JSON.parse((await run(["pr", "view", "7", "-R", REPO, "--full", "--json"])).out);
    expect(full.description).toBe(description);
  });

  it("maps 404 to NOT_FOUND", async () => {
    const { out, code } = await run(["pr", "view", "99", "-R", REPO, "--json"]);
    expect(JSON.parse(out)).toMatchObject({ code: "NOT_FOUND", help: ["Check the repository selector and the pull request number"] });
    expect(code).toBe(1);
  });

  it.each(["abc", "0"])("rejects the pull request id %s", async (id) => {
    const { out, code } = await run(["pr", "view", id, "-R", REPO, "--json"]);
    expect(JSON.parse(out)).toMatchObject({ code: "VALIDATION_ERROR", help: ["Run `bitbucket-dc-axi pr --help`"] });
    expect(code).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a reply that is not an object as INTERNAL_ERROR", async () => {
    routes(fetchMock, { [PR]: response(200, "<html>") });
    const { out, code } = await run(["pr", "view", "7", "-R", REPO, "--json"]);
    expect(JSON.parse(out)).toMatchObject({
      code: "INTERNAL_ERROR",
      help: ["Check that the host is the Bitbucket Data Center server, not a proxy or login page, and retry"],
    });
    expect(code).toBe(1);
  });
});

describe("pr create", () => {
  const created = (url: URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return response(201, pullRequest({ title: body.title, fromRef: { ...body.fromRef, displayId: "feat", latestCommit: HEAD }, toRef: { ...body.toRef, displayId: "main" } }));
  };
  const repository = { slug: "repo", project: { key: "PROJ" } };

  it("targets the default branch", async () => {
    routes(fetchMock, { [DEFAULT_BRANCH]: response(200, { id: "refs/heads/main", displayId: "main", type: "BRANCH" }), [CREATE]: created });
    const { out, code } = await run(["pr", "create", "--title", "T", "--source", "feat", "-R", REPO, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ id: 7, url: PR_URL, title: "T", state: "open" });
    const [first, second] = calls(fetchMock);
    expect(first!.path).toBe(`${BASE}/default-branch`);
    expect(second!.body).toEqual({ title: "T", fromRef: { id: "refs/heads/feat", repository }, toRef: { id: "refs/heads/main", repository } });
  });

  it("uses an explicit destination", async () => {
    routes(fetchMock, { [CREATE]: created });
    await run(["pr", "create", "--title", "T", "--source", "refs/heads/feat", "--destination", "dev", "-R", REPO]);
    expect(calls(fetchMock)).toHaveLength(1);
    expect(calls(fetchMock)[0]!.body).toMatchObject({ fromRef: { id: "refs/heads/feat" }, toRef: { id: "refs/heads/dev" } });
  });

  it("passes a body that starts with a dash", async () => {
    routes(fetchMock, { [CREATE]: created });
    await run(["pr", "create", "--title", "T", "--source", "feat", "--destination", "main", "--body", "- исправлен вход", "-R", REPO]);
    expect(calls(fetchMock)[0]!.body).toMatchObject({ description: "- исправлен вход" });
  });

  it.each([[["--source", "feat"]], [["--title", "T"]]])("requires title and source (%j)", async (flags) => {
    const { out, code } = await run(["pr", "create", ...flags, "-R", REPO, "--json"]);
    expect(JSON.parse(out).help).toEqual(["Run `bitbucket-dc-axi pr create --help`"]);
    expect(code).toBe(2);
    expect(loadToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("points to pr list when the created reply is not an object", async () => {
    routes(fetchMock, { [CREATE]: response(201, []) });
    const { out, code } = await run(["pr", "create", "--title", "T", "--source", "feat", "--destination", "main", "-R", REPO, "--json"]);
    expect(JSON.parse(out)).toMatchObject({
      code: "INTERNAL_ERROR",
      help: [`Run \`bitbucket-dc-axi pr list -R ${REPO}\` to see whether the pull request was created`],
    });
    expect(code).toBe(1);
  });

  it("reports a duplicate as API_ERROR", async () => {
    routes(fetchMock, {
      [CREATE]: response(409, { errors: [{ context: null, message: "Only one pull request may be open for a given source and target branch", exceptionName: "DuplicatePullRequestException" }] }),
    });
    const { out, code } = await run(["pr", "create", "--title", "T", "--source", "feat", "--destination", "main", "-R", REPO]);
    expect(out).toContain("API_ERROR");
    expect(out).not.toContain(TOKEN);
    expect(code).toBe(1);
  });
});

it("lists pr subcommands on a bad one", async () => {
  const { out, code } = await run(["pr", "bogus"]);
  expect(out).toContain("VALIDATION_ERROR");
  expect(out).toContain("list, view, create");
  expect(code).toBe(2);
});
