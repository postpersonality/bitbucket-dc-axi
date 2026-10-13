import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { AxiError } from "axi-sdk-js";
import { boolFlag, parseArgs, type ParsedArgs } from "../args.js";
import { validateToken, type Json } from "../client.js";
import { HOST_PATTERN } from "../context.js";
import { clearToken, loadToken, saveToken } from "../credentials.js";
import { noPositionals, requiredFlag, subcommandError } from "./utils.js";

export const CONFIG_HELP = `usage: bitbucket-dc-axi config <subcommand> --host <host> [flags]
description: Manage Bitbucket Data Center access tokens stored per host in the OS credential manager (Secret Service).
subcommands[3]:
  set, status, clear
flags{set}:
  --host <host>, --token-stdin (non-interactive; read the access token from stdin)
flags{status}:
  --host <host>
flags{clear}:
  --host <host>
examples[4]:
  bitbucket-dc-axi config set --host bitbucket.example.com
  token-producing-command | bitbucket-dc-axi config set --host bitbucket.example.com --token-stdin
  bitbucket-dc-axi config status --host bitbucket.example.com
  bitbucket-dc-axi config clear --host bitbucket.example.com
`;

export const MAX_TOKEN_BYTES = 8192;
const SUBCOMMANDS = ["set", "status", "clear"];

export interface ConfigSetIO {
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout?: { write(chunk: string): unknown; isTTY?: boolean };
}

export async function configCommand(args: string[], io: ConfigSetIO = {}): Promise<Record<string, Json>> {
  const subcommand = args[0];
  if (subcommand === "set") return configSet(args.slice(1), io);
  if (subcommand === "status") return configStatus(args.slice(1));
  if (subcommand === "clear") return configClear(args.slice(1));
  throw subcommandError("config", SUBCOMMANDS, subcommand);
}

export async function configSet(args: string[], io: ConfigSetIO = {}): Promise<Record<string, Json>> {
  const command = "bitbucket-dc-axi config set";
  const parsed = parseArgs(args, [{ name: "--host" }, { name: "--token-stdin", boolean: true }], command, { repo: false });
  noPositionals(parsed, command);
  const host = hostFlag(parsed, command);
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const tokenFromStdin = boolFlag(parsed, "--token-stdin");

  if (!tokenFromStdin && (!stdin.isTTY || !stdout.isTTY)) {
    throw new AxiError("interactive setup requires a terminal", "VALIDATION_ERROR", [
      `Run \`${command} --host ${host}\` in a terminal`,
      `For automation, pipe the access token to \`${command} --host ${host} --token-stdin\``,
    ]);
  }

  const tokenInput = tokenFromStdin
    ? await readTokenFromStdin(stdin)
    : await readInteractiveLine("Bitbucket access token: ", stdin, stdout);
  if (Buffer.byteLength(tokenInput) > MAX_TOKEN_BYTES)
    throw new AxiError("access token is too large", "VALIDATION_ERROR", [
      "Enter a single valid Bitbucket HTTP access token",
    ]);
  const token = tokenInput.trim();
  if (!token)
    throw new AxiError(
      tokenFromStdin ? "no access token received on stdin" : "no access token entered",
      "VALIDATION_ERROR",
      [
        tokenFromStdin
          ? `Pipe the access token to \`${command} --host ${host} --token-stdin\``
          : `Create an HTTP access token in Bitbucket, then run \`${command} --host ${host}\` again`,
      ],
    );

  const { user, version } = await validateToken(host, token);
  saveToken(host, token);
  return {
    config: { host, user, version, status: "configured" },
    help: [
      `Run \`bitbucket-dc-axi config status --host ${host}\` to verify`,
      `Run \`bitbucket-dc-axi pr list -R ${host}/<PROJECT>/<repo>\` to use the CLI`,
    ],
  };
}

export async function configStatus(args: string[]): Promise<Record<string, Json>> {
  const command = "bitbucket-dc-axi config status";
  const parsed = parseArgs(args, [{ name: "--host" }], command, { repo: false });
  noPositionals(parsed, command);
  const host = hostFlag(parsed, command);
  return { config: { host, status: loadToken(host) === null ? "not configured" : "configured" } };
}

export async function configClear(args: string[]): Promise<Record<string, Json>> {
  const command = "bitbucket-dc-axi config clear";
  const parsed = parseArgs(args, [{ name: "--host" }], command, { repo: false });
  noPositionals(parsed, command);
  const host = hostFlag(parsed, command);
  return { config: { host, status: clearToken(host) ? "cleared" : "already clear" } };
}

// Lowercased before any keychain access: the host is the entry's account name.
function hostFlag(parsed: ParsedArgs, command: string): string {
  const host = requiredFlag(parsed, "--host", command).trim().toLowerCase();
  if (!HOST_PATTERN.test(host))
    throw new AxiError(`invalid host: ${host}`, "VALIDATION_ERROR", [
      "Pass the host name with an optional port, without scheme or path, e.g. `--host bitbucket.example.com`",
    ]);
  return host;
}

async function readInteractiveLine(
  prompt: string,
  input: NodeJS.ReadableStream,
  output: { write(chunk: string): unknown },
): Promise<string> {
  output.write(prompt);
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const readline = createInterface({ input, output: silent, terminal: true });
  try {
    return await readline.question("");
  } finally {
    readline.close();
    output.write("\n");
  }
}

export async function readTokenFromStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_TOKEN_BYTES) {
      throw new AxiError("access token on stdin is too large", "VALIDATION_ERROR", [
        "Pipe a single valid Bitbucket HTTP access token via stdin",
      ]);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}
