import { encode } from "@toon-format/toon";
import { AxiError } from "axi-sdk-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_CODES, formatError, TOP_HELP } from "../src/cli.js";
import { BitbucketError } from "../src/client.js";
import { HEAD, REPO, run, setOrigin } from "./helpers.js";

vi.mock("node:child_process");
vi.mock("../src/credentials.js");

const cliFactory = vi.hoisted(() => vi.fn());

let stderr: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  setOrigin();
  stderr = vi.spyOn(process.stderr, "write");
});
afterEach(() => {
  expect(stderr).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("entry point", () => {
  it("answers --version without loading the CLI", async () => {
    vi.doMock("../src/cli.js", () => {
      cliFactory();
      return { main: vi.fn() };
    });
    const argv = process.argv;
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.argv = ["node", "bitbucket-dc-axi", "--version"];
    try {
      await import("../bin/bitbucket-dc-axi.js");
    } finally {
      process.argv = argv;
    }
    expect(stdout).toHaveBeenCalledWith("0.1.1\n");
    expect(cliFactory).not.toHaveBeenCalled();
    vi.doUnmock("../src/cli.js");
  });

  it("prints the version", async () => {
    expect(await run(["-v"])).toEqual({ out: "0.1.1\n", code: 0 });
  });
});

describe("commands", () => {
  it("shows the bounded top-level help", async () => {
    const { out, code } = await run(["--help"]);
    expect(out).toBe(TOP_HELP);
    expect(code).toBe(0);
    for (const removed of ["pipeline", "api", "repo view", "credential-helper"]) expect(out).not.toContain(removed);
  });

  it("hides the SDK updater", async () => {
    const { out, code } = await run(["update"]);
    expect(out).toContain("code: VALIDATION_ERROR");
    expect(out).toContain("Unknown command: update");
    expect(code).toBe(2);
  });

  it.each(["pipeline", "api", "credential-helper"])("rejects the removed %s command", async (command) => {
    expect((await run([command])).code).toBe(2);
  });

  it("reports unknown commands in JSON", async () => {
    const { out, code } = await run(["bogus", "--json"]);
    expect(JSON.parse(out)).toMatchObject({ code: "VALIDATION_ERROR", error: "Unknown command: bogus" });
    expect(code).toBe(2);
  });

  it("reports a leading flag in the requested format", async () => {
    const json = await run(["-R", REPO, "home", "--json"]);
    expect(JSON.parse(json.out)).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(json.code).toBe(2);
    const toon = await run(["-R", REPO, "home"]);
    expect(toon.out).toContain("code: VALIDATION_ERROR");
    expect(() => JSON.parse(toon.out)).toThrow();
    expect(toon.code).toBe(2);
  });
});

describe("formatError", () => {
  const expected: Record<string, number> = {
    NOT_FOUND: 1,
    MERGE_REJECTED: 1,
    HEAD_MOVED: 1,
    MERGED_DIFFERENT_HEAD: 1,
    NOT_OPEN: 1,
    API_ERROR: 1,
    INTERNAL_ERROR: 1,
    VALIDATION_ERROR: 2,
    NOT_CONFIGURED: 3,
    CREDENTIAL_STORE_ERROR: 3,
    REPO_NOT_RESOLVED: 3,
    AUTH_ERROR: 4,
    PERMISSION_ERROR: 4,
    NETWORK_ERROR: 5,
    SERVER_ERROR: 5,
  };

  it("covers every documented code", () => expect(EXIT_CODES).toEqual(expected));

  it.each(Object.entries(expected))("maps %s to exit %i", (code, exitCode) => {
    expect(formatError(new AxiError("x", code), false).exitCode).toBe(exitCode);
  });

  it("falls back to 1 for an unknown code", () => {
    expect(formatError(new AxiError("x", "SOMETHING_NEW"), false).exitCode).toBe(1);
  });

  it("hides unexpected failures", () => {
    const { output, exitCode } = formatError(new Error("boom"), false);
    expect(output).toContain("INTERNAL_ERROR");
    expect(output).toContain("Unexpected failure");
    expect(output).toContain("Retry with validated arguments; report the command if the failure persists");
    expect(output).not.toContain("boom");
    expect(exitCode).toBe(1);
  });

  it("lifts server extras to the top level", () => {
    const vetoes = [{ summary: "Needs approval", detail: "One approval required" }];
    const error = new BitbucketError("Rejected", "API_ERROR", ["See `details`"], { status: 409, details: ["reason"], vetoes });
    expect(JSON.parse(formatError(error, true).output)).toEqual({
      error: "Rejected",
      code: "API_ERROR",
      help: ["See `details`"],
      status: 409,
      details: ["reason"],
      vetoes,
    });
  });

  it("lifts merge state extras to the top level", () => {
    const error = new BitbucketError("x", "NOT_OPEN", [], { state: "declined", head: HEAD, sha: HEAD });
    expect(JSON.parse(formatError(error, true).output)).toMatchObject({ state: "declined", head: HEAD, sha: HEAD });
  });

  it("renders TOON without --json", () => {
    const error = new BitbucketError("x", "NOT_OPEN", ["h"], { state: "declined" });
    expect(formatError(error, false).output).toBe(`${encode({ error: "x", code: "NOT_OPEN", help: ["h"], state: "declined" })}\n`);
  });
});
