import { encode } from "@toon-format/toon";
import { AxiError, runAxiCli } from "axi-sdk-js";
import { stripRepoFlag } from "./args.js";
import { BitbucketError, type Json } from "./client.js";
import { BUILDS_HELP, buildsCommand, CONFIG_HELP, configCommand, HOME_HELP, homeCommand } from "./commands/index.js";
import { resolveRepo, type RepoContext } from "./context.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Read, check, and merge Bitbucket Data Center pull requests by verified commit with agent-efficient output.";
export const TOP_HELP = `usage: bitbucket-dc-axi [command] [args] [flags]
commands[4]:
  home, pr list|view|create|merge-check|merge, builds, config set|status|clear
flags[4]:
  -R/--repo <host>/<PROJECT>/<repo> (after command), --json, --help, -v/-V/--version
examples[4]:
  bitbucket-dc-axi
  bitbucket-dc-axi pr view https://bitbucket.example.com/projects/PROJ/repos/repo/pull-requests/7 --json
  bitbucket-dc-axi pr list -R bitbucket.example.com/PROJ/repo
  bitbucket-dc-axi config set --host bitbucket.example.com
`;

export type Handler = (args: string[], ctx?: RepoContext) => Promise<Record<string, Json>>;

export const HELP: Record<string, string> = {
  home: HOME_HELP,
  builds: BUILDS_HELP,
  config: CONFIG_HELP,
};

export const EXIT_CODES: Record<string, number> = {
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

const HELP_HINT = "Run `bitbucket-dc-axi --help` to see available commands";

export async function main(options: {
  argv?: string[];
  stdout?: { write(chunk: string): unknown };
} = {}): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const given = options.argv ?? process.argv.slice(2);
  const json = given.includes("--json");
  let argv = given.filter((arg) => arg !== "--json");
  if (json && argv.length === 0) argv = ["home"];

  // axi-sdk-js renders a leading-flag error only in TOON.
  const first = argv[0];
  const passThrough = argv.length === 1 && (first === "--help" || first === "-v" || first === "-V" || first === "--version");
  if (json && first?.startsWith("-") && !passThrough) {
    const error = new AxiError("Flags must come after the command", "VALIDATION_ERROR", [
      "Run `bitbucket-dc-axi <command> [args] [flags]`",
      `Move \`${first}\` after the command instead of before it`,
    ]);
    const formatted = formatError(error, true);
    stdout.write(formatted.output);
    process.exitCode = formatted.exitCode;
    return;
  }

  const render = (output: Record<string, Json>) => (json ? JSON.stringify(output) : output);
  // Resolve the repository inside handlers so its errors use the same formatter.
  const wrap = (handler: Handler) => async (args: string[]) =>
    render(await handler(stripRepoFlag(args), resolveRepo(args)));

  await runAxiCli({
    argv,
    stdout,
    description: DESCRIPTION,
    version: VERSION,
    packageName: "bitbucket-dc-axi",
    topLevelHelp: TOP_HELP,
    commands: {
      home: wrap(homeCommand),
      builds: wrap(buildsCommand),
      // No repository context; the hidden-input prompt goes to the same stdout.
      config: async (args) => render(await configCommand(args, { stdout })),
      // Shadow the SDK's self-update: it writes to stderr and this tool has no updater.
      update: async () => {
        throw new AxiError("Unknown command: update", "VALIDATION_ERROR", [HELP_HINT]);
      },
    },
    home: wrap(homeCommand),
    getCommandHelp: (command) => HELP[command],
    renderUnknownCommand: (command) =>
      formatError(new AxiError(`Unknown command: ${command}`, "VALIDATION_ERROR", [HELP_HINT]), json).output,
    formatError: (error) => formatError(error, json),
  });
}

export function formatError(error: unknown, json: boolean): { output: string; exitCode: number } {
  const record: Record<string, Json> =
    error instanceof AxiError
      ? {
          error: error.message,
          code: error.code,
          ...(error.suggestions.length ? { help: error.suggestions } : {}),
          ...(error instanceof BitbucketError ? error.extras : {}),
        }
      : {
          error: "Unexpected failure",
          code: "INTERNAL_ERROR",
          help: ["Retry with validated arguments; report the command if the failure persists"],
        };
  const code = String(record["code"]);
  return {
    output: `${json ? JSON.stringify(record) : encode(record)}\n`,
    exitCode: EXIT_CODES[code] ?? 1,
  };
}
