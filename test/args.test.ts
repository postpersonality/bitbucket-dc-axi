import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { findRepoFlag, parseArgs, positiveInt, stripRepoFlag, type FlagDefinition } from "../src/args.js";

const DEFS: FlagDefinition[] = [
  { name: "--body" },
  { name: "--title" },
  { name: "--full", boolean: true },
];

function parse(args: string[]) {
  return parseArgs(args, DEFS, "bitbucket-dc-axi pr create");
}

function failure(fn: () => unknown): AxiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AxiError);
    expect((error as AxiError).code).toBe("VALIDATION_ERROR");
    return error as AxiError;
  }
  throw new Error("expected a VALIDATION_ERROR");
}

describe("parseArgs", () => {
  it("accepts a separate value that starts with a dash", () => {
    expect(parse(["--body", "- исправлен вход"]).flags.get("--body")).toBe("- исправлен вход");
  });

  it("accepts the same value in --flag=value form", () => {
    expect(parse(["--body=- исправлен вход"]).flags.get("--body")).toBe("- исправлен вход");
  });

  it("accepts any non-empty value after =", () => {
    expect(parse(["--body=--title"]).flags.get("--body")).toBe("--title");
  });

  it("accepts a dash value that is not a flag of the command", () => {
    expect(parse(["--body", "-5"]).flags.get("--body")).toBe("-5");
  });

  it("requires a value", () => {
    expect(failure(() => parse(["--body"])).message).toBe("--body requires a value");
    failure(() => parse(["--body="]));
  });

  it.each([
    [["--body", "--title", "x"]],
    [["--body", "-R", "x"]],
    [["--body", "--title=x"]],
  ])("rejects a command flag as a separate value: %j", (args) => {
    expect(failure(() => parse(args)).message).toBe("--body requires a value");
  });

  it("rejects unknown flags", () => {
    expect(failure(() => parse(["--bogus"])).message).toBe(
      "unknown flag --bogus for bitbucket-dc-axi pr create",
    );
  });

  it("rejects a repeated flag", () => {
    expect(failure(() => parse(["--title", "a", "--title", "b"])).message).toContain(
      "may only be given once",
    );
  });

  it("rejects a value on a boolean flag", () => {
    expect(failure(() => parse(["--full=x"])).message).toContain("does not take a value");
  });
});

describe("repository flag", () => {
  it("requires a value with a Data Center hint", () => {
    const error = failure(() => findRepoFlag(["-R"]));
    expect(error.suggestions.join("\n")).toContain("<host>/<PROJECT>/<repo>");
  });

  it("may only be given once", () => {
    expect(failure(() => findRepoFlag(["-R", "h/P/r", "--repo", "h/P/s"])).message).toContain(
      "may only be given once",
    );
  });

  it("is stripped in both forms", () => {
    expect(stripRepoFlag(["view", "-R", "h/P/r", "--repo=h/P/r", "1"])).toEqual(["view", "1"]);
  });
});

describe("positiveInt", () => {
  it.each(["0", "101", "1.5"])("rejects %s", (value) => {
    failure(() => positiveInt(value, "--limit", 30));
  });

  it("falls back when absent", () => {
    expect(positiveInt(undefined, "--limit", 30)).toBe(30);
  });
});
