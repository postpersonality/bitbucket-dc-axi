import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatError } from "../src/cli.js";
import { configCommand, type ConfigSetIO } from "../src/commands/config.js";
import { HOST, REPO, response, run, TOKEN } from "./helpers.js";

vi.mock("node:child_process");

const keyring = vi.hoisted(() => ({
  Entry: vi.fn(),
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deleteCredential: vi.fn(),
}));
vi.mock("@napi-rs/keyring", () => ({ Entry: keyring.Entry }));

const fetchMock = vi.fn<typeof fetch>();
let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  keyring.Entry.mockImplementation(() => ({
    getPassword: keyring.getPassword,
    setPassword: keyring.setPassword,
    deleteCredential: keyring.deleteCredential,
  }));
  vi.stubGlobal("fetch", fetchMock);
  stderr = vi.spyOn(process.stderr, "write");
});
afterEach(() => {
  expect(stderr).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stdinInput(value: string): PassThrough {
  const input = new PassThrough();
  input.end(value);
  return input;
}

// A fake terminal: answers the prompt once it appears on stdout.
function terminal(answer: string): { stdin: PassThrough & { isTTY: boolean }; stdout: PassThrough & { isTTY: boolean }; written: () => string } {
  const stdin = Object.assign(new PassThrough(), { isTTY: true });
  const stdout = Object.assign(new PassThrough(), { isTTY: true });
  let transcript = "";
  stdout.on("data", (chunk) => {
    transcript += chunk.toString();
    if (transcript === "Bitbucket access token: ") setImmediate(() => stdin.write(`${answer}\n`));
  });
  return { stdin, stdout, written: () => transcript };
}

async function exec(args: string[], io: ConfigSetIO = {}): Promise<{ out: string; code: number }> {
  try {
    return { out: JSON.stringify(await configCommand(args, io)), code: 0 };
  } catch (error) {
    const { output, exitCode } = formatError(error, true);
    return { out: output, code: exitCode };
  }
}

const RETRY = ["Create a personal HTTP access token with REPO_READ (REPO_WRITE to merge) and enter it again"];

function accepted(user?: string): void {
  fetchMock.mockResolvedValue(response(200, { version: "10.0.1", buildNumber: "10000001" }, user ? { "X-AUSERNAME": user } : {}));
}

describe("config set", () => {
  it("validates and stores a token from stdin", async () => {
    accepted("jdoe");
    const { out, code } = await exec(["set", "--host", HOST, "--token-stdin"], { stdin: stdinInput(`${TOKEN}\n`) });
    expect(code).toBe(0);
    expect(JSON.parse(out).config).toEqual({ host: HOST, user: "jdoe", version: "10.0.1", status: "configured" });
    expect(out).not.toContain(TOKEN);
    expect(keyring.Entry).toHaveBeenCalledWith("bitbucket-dc-axi", HOST, { linux: { store: "secret-service" } });
    expect(keyring.setPassword).toHaveBeenCalledWith(TOKEN);
  });

  it("rejects a token without X-AUSERNAME", async () => {
    accepted();
    const { out, code } = await exec(["set", "--host", HOST, "--token-stdin"], { stdin: stdinInput(TOKEN) });
    expect(JSON.parse(out)).toMatchObject({ code: "AUTH_ERROR", help: RETRY });
    expect(code).toBe(4);
    expect(keyring.setPassword).not.toHaveBeenCalled();
  });

  it("rejects a token the server refuses", async () => {
    fetchMock.mockResolvedValue(response(401, { errors: [{ message: "Authentication failed" }] }));
    const { out, code } = await exec(["set", "--host", HOST, "--token-stdin"], { stdin: stdinInput(TOKEN) });
    expect(JSON.parse(out)).toMatchObject({ code: "AUTH_ERROR", help: RETRY });
    expect(code).toBe(4);
    expect(keyring.setPassword).not.toHaveBeenCalled();
  });

  it("hints at --host when the server answers 404", async () => {
    fetchMock.mockResolvedValue(response(404));
    const { out, code } = await exec(["set", "--host", HOST, "--token-stdin"], { stdin: stdinInput(TOKEN) });
    expect(JSON.parse(out)).toMatchObject({
      code: "NOT_FOUND",
      help: [`Check that \`--host ${HOST}\` is the address of the Bitbucket Data Center server`],
    });
    expect(code).toBe(1);
    expect(keyring.setPassword).not.toHaveBeenCalled();
  });

  it("prompts on stdout in a terminal without echoing the token", async () => {
    accepted("jdoe");
    const tty = terminal(TOKEN);
    const { out, code } = await exec(["set", "--host", HOST], { stdin: tty.stdin, stdout: tty.stdout });
    expect(code).toBe(0);
    expect(tty.written()).toBe("Bitbucket access token: \n");
    expect(out).not.toContain(TOKEN);
    expect(keyring.setPassword).toHaveBeenCalledWith(TOKEN);
  });

  it.each([
    ["stdin is a terminal but stdout is not", { stdin: Object.assign(new PassThrough(), { isTTY: true }), stdout: new PassThrough() }],
    ["neither is a terminal", { stdin: new PassThrough(), stdout: new PassThrough() }],
  ])("requires --token-stdin when %s", async (_case, io) => {
    const { out, code } = await exec(["set", "--host", HOST], io);
    expect(JSON.parse(out).code).toBe("VALIDATION_ERROR");
    expect(out).toContain("--token-stdin");
    expect(code).toBe(2);
    expect(keyring.Entry).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lowercases the host before touching the keychain", async () => {
    accepted("jdoe");
    await exec(["set", "--host", "BITBUCKET.example.com", "--token-stdin"], { stdin: stdinInput(TOKEN) });
    expect(keyring.Entry).toHaveBeenCalledWith("bitbucket-dc-axi", HOST, expect.anything());
    keyring.Entry.mockClear();
    await exec(["status", "--host", "BITBUCKET.example.com"]);
    expect(keyring.Entry).toHaveBeenCalledWith("bitbucket-dc-axi", HOST, expect.anything());
  });

  it.each([[["set"]], [["set", "--host", "https://h"]], [["set", "--host", "h/x"]], [["set", "--host", HOST, "--bogus"]]])(
    "rejects %j before the keychain and network",
    async (args) => {
      const { out, code } = await run(["config", ...args, "--json"]);
      expect(JSON.parse(out).help?.length).toBeGreaterThan(0);
      expect(code).toBe(2);
      expect(keyring.Entry).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([["empty", "\n"], ["oversized", "x".repeat(8193)]])("rejects an %s token", async (_case, input) => {
    const { code } = await exec(["set", "--host", HOST, "--token-stdin"], { stdin: stdinInput(input) });
    expect(code).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing Secret Service", async () => {
    accepted("jdoe");
    keyring.setPassword.mockImplementation(() => {
      throw new Error("Platform secure storage failure: DBus error");
    });
    const { out, code } = await exec(["set", "--host", HOST, "--token-stdin"], { stdin: stdinInput(TOKEN) });
    expect(JSON.parse(out).code).toBe("CREDENTIAL_STORE_ERROR");
    expect(code).toBe(3);
  });
});

describe("config status and clear", () => {
  it("reports the entry without the network", async () => {
    keyring.getPassword.mockReturnValue(TOKEN);
    const configured = await run(["config", "status", "--host", HOST]);
    expect(configured.out).toContain("status: configured");
    expect(configured.code).toBe(0);
    keyring.getPassword.mockReturnValue(null);
    const missing = await run(["config", "status", "--host", HOST]);
    expect(missing.out).toContain("status: not configured");
    expect(missing.code).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers in JSON", async () => {
    keyring.getPassword.mockReturnValue(TOKEN);
    expect(JSON.parse((await run(["config", "status", "--host", HOST, "--json"])).out).config.status).toBe("configured");
  });

  it("clears idempotently", async () => {
    keyring.deleteCredential.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect((await run(["config", "clear", "--host", HOST])).out).toContain("status: cleared");
    const again = await run(["config", "clear", "--host", HOST]);
    expect(again.out).toContain("already clear");
    expect(again.code).toBe(0);
  });

  it.each(
    ["set", "status", "clear"].flatMap((subcommand) =>
      [["-R", REPO], ["--repo", REPO], [`-R=${REPO}`], [`--repo=${REPO}`]].map((flag) => [subcommand, flag] as const),
    ),
  )("rejects config %s with %j like any unknown flag", async (subcommand, flag) => {
    const unknown = JSON.parse((await run(["config", subcommand, "--host", HOST, "--bogus", "--json"])).out);
    const { out, code } = await run(["config", subcommand, "--host", HOST, ...flag, "--json"]);
    expect(JSON.parse(out)).toEqual({ ...unknown, error: `unknown flag ${flag[0]!.split("=")[0]} for bitbucket-dc-axi config ${subcommand}` });
    expect(code).toBe(2);
    expect(keyring.Entry).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["git", "bogus"])("rejects config %s", async (subcommand) => {
    const { out, code } = await run(["config", subcommand]);
    expect(out).toContain("VALIDATION_ERROR");
    expect(code).toBe(2);
  });
});
