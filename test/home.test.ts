import { decode } from "@toon-format/toon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESCRIPTION } from "../src/cli.js";
import { loadToken } from "../src/credentials.js";
import { calls, fakeServer, pullRequest, page, REPO, response, routes, run, setOrigin, type FetchMock } from "./helpers.js";

vi.mock("node:child_process");
vi.mock("../src/credentials.js");

const LIST = "GET /rest/api/1.0/projects/PROJ/repos/repo/pull-requests";

let fetchMock: FetchMock;
let stderr: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  fetchMock = fakeServer();
  stderr = vi.spyOn(process.stderr, "write");
});
afterEach(() => {
  expect(stderr).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("outside a repository", () => {
  beforeEach(() => setOrigin());

  it("renders the home view with a header", async () => {
    const { out, code } = await run([]);
    expect(out).toContain("bin:");
    expect(out).toContain("description:");
    expect(out).toContain("not detected");
    expect(code).toBe(0);
  });

  it("points to -R and config set", async () => {
    const { out, code } = await run(["home"]);
    expect(out).toContain("not detected");
    expect(out).toContain("-R <host>/<PROJECT>/<repo>");
    expect(out).toContain("config set --host");
    expect(code).toBe(0);
  });

  it("answers the bare call in JSON with the same header", async () => {
    const { out, code } = await run(["--json"]);
    const home = JSON.parse(out);
    expect(home).toMatchObject({ bin: expect.any(String), description: DESCRIPTION, repository: "not detected", pull_requests: [] });
    expect(home).toEqual(decode((await run([])).out));
    expect(code).toBe(0);
  });

  it("answers home in JSON without the header", async () => {
    const { out, code } = await run(["home", "--json"]);
    const home = JSON.parse(out);
    expect(home).not.toHaveProperty("bin");
    expect(home).toEqual(decode((await run(["home"])).out));
    expect(code).toBe(0);
  });
});

describe("inside a repository", () => {
  it.each([
    ["git@github.com:o/r.git", ["home"]],
    ["https://github.com/o/r.git", []],
  ])("asks to configure the host of %s", async (origin, argv) => {
    setOrigin(origin);
    vi.mocked(loadToken).mockReturnValue(null);
    const { out, code } = await run(argv);
    expect(out).toContain("code: NOT_CONFIGURED");
    expect(out).toContain("config set --host github.com");
    expect(code).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks to configure the host from -R", async () => {
    setOrigin();
    vi.mocked(loadToken).mockReturnValue(null);
    const { out, code } = await run(["home", "-R", REPO]);
    expect(out).toContain("code: NOT_CONFIGURED");
    expect(out).toContain("config set --host bitbucket.example.com");
    expect(code).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([[["home"]], [[]]])("reports an origin that is not a Bitbucket repository for %j", async (argv) => {
    setOrigin("https://github.com/o/r.git");
    const { out, code } = await run(argv);
    expect(out).toContain("code: REPO_NOT_RESOLVED");
    expect(code).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists the newest five open pull requests", async () => {
    setOrigin("ssh://git@bitbucket.example.com:7999/PROJ/repo.git");
    const prs = Array.from({ length: 7 }, (_, i) => pullRequest({ id: i + 1 }));
    routes(fetchMock, { [LIST]: (url) => response(200, page(prs.slice(0, Number(url.searchParams.get("limit"))), { isLastPage: false })) });
    const { out, code } = await run(["home", "--json"]);
    expect(code).toBe(0);
    const home = JSON.parse(out);
    expect(home.pull_requests).toHaveLength(5);
    expect(home.pull_requests[0]).toEqual({ id: 1, title: "Add feature", state: "open", author: "Jane Doe" });
    expect(calls(fetchMock)[0]).toMatchObject({
      method: "GET",
      path: "/rest/api/1.0/projects/PROJ/repos/repo/pull-requests",
      query: { state: "OPEN", limit: "5", order: "NEWEST" },
    });
  });

  it("maps a server failure to exit 5", async () => {
    setOrigin("git@bitbucket.example.com:PROJ/repo.git");
    routes(fetchMock, { [LIST]: response(500, { errors: [{ message: "boom" }] }) });
    const { out, code } = await run(["home"]);
    expect(out).toContain("SERVER_ERROR");
    expect(code).toBe(5);
  });
});
