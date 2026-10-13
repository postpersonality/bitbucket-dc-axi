import { describe, expect, it } from "vitest";
import {
  FULL_COMMIT,
  LIST_FIELDS,
  listRow,
  parseFields,
  positiveId,
  prCore,
  prPath,
  prRef,
  repoPath,
  subcommandError,
  truncate,
} from "../src/commands/utils.js";
import type { JsonObject } from "../src/client.js";
import type { RepoContext } from "../src/context.js";

const FLAG: RepoContext = { host: "bitbucket.example.com", project: "PROJ", slug: "repo", nwo: "bitbucket.example.com/PROJ/repo", source: "flag" };
const PR_URL = "https://bitbucket.example.com/projects/PROJ/repos/repo/pull-requests/7";
const HEAD = "a".repeat(40);
const CREATED = Date.UTC(2026, 9, 12, 8, 30);

const PR_10: JsonObject = {
  id: 7,
  title: "Add feature",
  state: "OPEN",
  draft: true,
  author: { user: { name: "jdoe", displayName: "Jane Doe" } },
  fromRef: { displayId: "feature", latestCommit: HEAD },
  toRef: { displayId: "main" },
  createdDate: CREATED,
  links: { self: [{ href: PR_URL }] },
};

function caught(action: () => unknown): { code?: string; suggestions?: string[] } {
  try {
    action();
  } catch (error) {
    return error as { code?: string; suggestions?: string[] };
  }
  throw new Error("expected an error");
}

describe("paths", () => {
  it("encodes key and slug", () => {
    const ctx = { ...FLAG, project: "~jdoe", slug: "a b" };
    expect(repoPath(ctx)).toBe("api/1.0/projects/~jdoe/repos/a%20b");
    expect(prPath(ctx, 7)).toMatch(/\/pull-requests\/7$/);
  });
});

describe("prCore", () => {
  it("reads a 10.0 pull request", () => {
    expect(prCore(PR_10)).toEqual({
      id: 7,
      title: "Add feature",
      state: "open",
      draft: true,
      author: "Jane Doe",
      source: "feature",
      destination: "main",
      head: HEAD,
      url: PR_URL,
    });
  });

  it("defaults draft and url on an 8.9 pull request", () => {
    const { draft: _draft, links: _links, ...pr89 } = PR_10;
    expect(prCore({ ...pr89, author: { user: { name: "jdoe" } } })).toMatchObject({ draft: false, url: "", author: "jdoe" });
  });
});

describe("list rows", () => {
  it("adds the selected fields", () => {
    expect(listRow(PR_10, ["url", "created"])).toEqual({
      id: 7,
      title: "Add feature",
      state: "open",
      author: "Jane Doe",
      url: PR_URL,
      created: "2026-10-12T08:30:00.000Z",
    });
  });

  it("rejects unknown fields", () => {
    expect(caught(() => parseFields("bogus", LIST_FIELDS, "pr list")).code).toBe("VALIDATION_ERROR");
  });
});

describe("prRef", () => {
  it("repeats a URL or names the number with -R", () => {
    expect(prRef(PR_URL, { ctx: { ...FLAG, source: "url" }, id: 7, byUrl: true })).toBe(PR_URL);
    expect(prRef("7", { ctx: FLAG, id: 7, byUrl: false })).toBe("7 -R bitbucket.example.com/PROJ/repo");
  });
});

describe("FULL_COMMIT", () => {
  it("matches only 40 hex digits", () => {
    expect(FULL_COMMIT.test(HEAD)).toBe(true);
    expect(FULL_COMMIT.test("A".repeat(40))).toBe(true);
    expect(FULL_COMMIT.test("a".repeat(39))).toBe(false);
    expect(FULL_COMMIT.test("abc123")).toBe(false);
  });
});

describe("positiveId", () => {
  it("rejects zero and unsafe integers", () => {
    expect(positiveId("7", "id")).toBe(7);
    expect(caught(() => positiveId("9007199254740993", "id")).code).toBe("VALIDATION_ERROR");
    expect(caught(() => positiveId("0", "id")).code).toBe("VALIDATION_ERROR");
  });
});

describe("truncate", () => {
  it("keeps a surrogate pair whole", () => {
    const result = truncate(`${"a".repeat(699)}😀${"b".repeat(50)}`, 700);
    expect(result.startsWith(`${"a".repeat(699)}😀…`)).toBe(true);
    expect(result).toContain("750 chars total");
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result)).toBe(false);
  });
});

describe("subcommandError", () => {
  it("points to the group help", () => {
    expect(subcommandError("pr", ["list"]).suggestions?.join("\n")).toContain("bitbucket-dc-axi pr --help");
  });
});
