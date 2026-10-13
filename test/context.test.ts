import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseOrigin, requireRepo, resolvePrTarget, resolveRepo, type RepoContext } from "../src/context.js";
import { loadToken } from "../src/credentials.js";

vi.mock("node:child_process");
vi.mock("../src/credentials.js");

const REPO = { host: "bitbucket.example.com", project: "proj", slug: "repo", nwo: "bitbucket.example.com/proj/repo", source: "git" };
const PR_URL = "https://bitbucket.example.com/projects/PROJ/repos/repo/pull-requests/7/overview";
const GIT: RepoContext = { host: "bitbucket.example.com", project: "OTHER", slug: "x", nwo: "bitbucket.example.com/OTHER/x", source: "git" };
const FLAG: RepoContext = { host: "bitbucket.example.com", project: "PROJ", slug: "repo", nwo: "bitbucket.example.com/PROJ/repo", source: "flag" };
const GITHUB: RepoContext = { host: "github.com", project: "", slug: "", nwo: "github.com", source: "foreign" };

function caught(action: () => unknown): { code?: string; suggestions?: string[] } {
  try {
    action();
  } catch (error) {
    return error as { code?: string; suggestions?: string[] };
  }
  throw new Error("expected an error");
}

beforeEach(() => vi.resetAllMocks());

describe("parseOrigin", () => {
  it.each([
    "ssh://git@bitbucket.example.com:7999/proj/repo.git",
    "git@bitbucket.example.com:proj/repo.git",
    "https://bitbucket.example.com/scm/proj/repo.git",
    "https://jdoe@bitbucket.example.com/scm/proj/repo.git",
  ])("reads %s", (url) => expect(parseOrigin(url)).toEqual(REPO));

  it("keeps the HTTPS port and drops the SSH port", () => {
    expect(parseOrigin("https://bitbucket.example.com:8443/scm/proj/repo.git")?.host).toBe("bitbucket.example.com:8443");
    expect(parseOrigin("ssh://git@Bitbucket.Example.COM:7999/proj/repo.git")?.host).toBe("bitbucket.example.com");
  });

  it("reads a personal repository key", () => {
    expect(parseOrigin("ssh://git@bitbucket.example.com:7999/~jdoe/test.git")?.project).toBe("~jdoe");
  });

  it("treats other hosts by form", () => {
    expect(parseOrigin("git@github.com:o/r.git")).toMatchObject({ host: "github.com", project: "o", slug: "r", source: "git" });
    expect(parseOrigin("https://github.com/o/r.git")).toMatchObject({ host: "github.com", project: "", slug: "", source: "foreign" });
    expect(parseOrigin("/srv/git/repo.git")).toBeUndefined();
    expect(parseOrigin("file:///srv/git/repo.git")).toBeUndefined();
  });
});

describe("resolveRepo", () => {
  it("prefers -R without calling git", () => {
    expect(resolveRepo(["-R", "bitbucket.example.com/PROJ/repo"])).toEqual(FLAG);
    expect(resolveRepo(["-R", "Bitbucket.Example.com/PROJ/repo"])?.host).toBe("bitbucket.example.com");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("rejects an incomplete -R", () => {
    expect(caught(() => resolveRepo(["-R", "bitbucket.example.com/PROJ"])).code).toBe("VALIDATION_ERROR");
  });

  it("reads origin quietly without touching the keychain", () => {
    vi.mocked(execFileSync).mockReturnValue("git@bitbucket.example.com:proj/repo.git\n");
    expect(resolveRepo([])).toEqual(REPO);
    expect(execFileSync).toHaveBeenCalledWith("git", ["remote", "get-url", "origin"], expect.objectContaining({ stdio: ["ignore", "pipe", "ignore"] }));
    expect(loadToken).not.toHaveBeenCalled();
  });

  it("returns nothing when git fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not a git repository");
    });
    expect(resolveRepo([])).toBeUndefined();
    const error = caught(() => requireRepo(undefined));
    expect(error.code).toBe("REPO_NOT_RESOLVED");
    expect(error.suggestions?.join("\n")).toContain("-R <host>/<PROJECT>/<repo>");
  });
});

describe("requireRepo", () => {
  it("asks to configure a foreign host without a token", () => {
    vi.mocked(loadToken).mockReturnValue(null);
    const error = caught(() => requireRepo(GITHUB));
    expect(error.code).toBe("NOT_CONFIGURED");
    expect(error.suggestions?.join("\n")).toContain("config set --host github.com");
  });

  it("reports an unresolved repository on a configured foreign host", () => {
    vi.mocked(loadToken).mockReturnValue("token");
    expect(caught(() => requireRepo(GITHUB)).code).toBe("REPO_NOT_RESOLVED");
  });

  it("returns a resolved context as is", () => {
    expect(requireRepo(GIT)).toBe(GIT);
    expect(loadToken).not.toHaveBeenCalled();
  });
});

describe("resolvePrTarget", () => {
  it("takes the repository from a pull request URL", () => {
    expect(resolvePrTarget(PR_URL)).toMatchObject({ id: 7, byUrl: true, ctx: { source: "url", nwo: "bitbucket.example.com/PROJ/repo" } });
    expect(resolvePrTarget(PR_URL, GIT).ctx).toMatchObject({ project: "PROJ", slug: "repo", source: "url" });
  });

  it("rejects a URL combined with -R", () => {
    expect(caught(() => resolvePrTarget(PR_URL, FLAG)).code).toBe("VALIDATION_ERROR");
  });

  it("resolves a number against the context", () => {
    expect(resolvePrTarget("7", GIT)).toEqual({ ctx: GIT, id: 7, byUrl: false });
    expect(caught(() => resolvePrTarget("7", undefined)).code).toBe("REPO_NOT_RESOLVED");
    expect(caught(() => resolvePrTarget("x")).code).toBe("VALIDATION_ERROR");
    expect(loadToken).not.toHaveBeenCalled();
  });

  it("points personal repository URLs to -R", () => {
    const error = caught(() => resolvePrTarget("https://bitbucket.example.com/users/jdoe/repos/test/pull-requests/1"));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.suggestions?.join("\n")).toContain("~jdoe");
  });
});
