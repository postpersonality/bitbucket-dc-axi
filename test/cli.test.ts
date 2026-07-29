import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, TOP_HELP } from "../src/cli.js";

describe("CLI", () => {
  const fetchMock = vi.fn<typeof fetch>();
  let output = "";
  const stdout = { write: (chunk: string) => { output += chunk; } };

  beforeEach(() => {
    output = "";
    process.exitCode = undefined;
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.unstubAllGlobals();
  });

  it("shows concise top-level help", async () => {
    await main({ argv: ["--help"], stdout });
    expect(output).toBe(TOP_HELP);
    expect(output).toContain("commands[4]");
  });

  it("prints the package version", async () => {
    await main({ argv: ["--version"], stdout });
    expect(output).toBe("0.1.0\n");
  });

  it("rejects unknown arguments before the network", async () => {
    await main({ argv: ["pr", "list", "--stat", "open", "-R", "acme/widgets"], stdout });
    expect(process.exitCode).toBe(2);
    expect(output).toContain("unknown flag --stat");
    expect(output).toContain("Valid flags:");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("formats invalid repository selectors without a stack trace", async () => {
    await main({ argv: ["repo", "view", "-R", "invalid"], stdout });
    expect(process.exitCode).toBe(2);
    expect(output).toContain("invalid repository: invalid");
    expect(output).not.toContain("AxiError");
    expect(output).not.toContain("at parseRepo");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a no-argument home view without credentials", async () => {
    delete process.env["ATLASSIAN_EMAIL"];
    delete process.env["BITBUCKET_API_TOKEN"];
    await main({ argv: [], stdout });
    expect(output).toContain("bin:");
    expect(output).toContain("description:");
    expect(output).toMatch(/repository: (not detected|[^\n]+)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
