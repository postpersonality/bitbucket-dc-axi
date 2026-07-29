import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBitbucketRemote, resolveRepo } from "../src/context.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
const mockedExecFileSync = vi.mocked(execFileSync);

describe("repository detection", () => {
  beforeEach(() => mockedExecFileSync.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("prefers an explicit repository", () => {
    expect(resolveRepo(["list", "-R", "acme/widgets"])).toEqual({
      workspace: "acme",
      repo: "widgets",
      nwo: "acme/widgets",
      source: "flag",
    });
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("finds a Bitbucket repository among git remotes", () => {
    mockedExecFileSync.mockReturnValue(
      "origin\thttps://example.com/acme/widgets.git (fetch)\nbitbucket\tgit@bitbucket.org:acme/widgets.git (fetch)\n",
    );
    expect(resolveRepo([])).toMatchObject({ nwo: "acme/widgets", source: "git" });
  });

  it("parses HTTPS and ssh URLs", () => {
    expect(parseBitbucketRemote("https://bitbucket.org/acme/widgets.git")?.nwo).toBe("acme/widgets");
    expect(parseBitbucketRemote("ssh://git@bitbucket.org/acme/widgets.git")?.nwo).toBe("acme/widgets");
    expect(parseBitbucketRemote("https://github.com/acme/widgets.git")).toBeUndefined();
  });
});
