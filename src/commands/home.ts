import { parseArgs } from "../args.js";
import { bitbucketRequest, type Json } from "../client.js";
import type { RepoContext } from "../context.js";
import { loadToken } from "../credentials.js";
import { jsonArray, listRow, noPositionals, object, repoHint, repoPath } from "./utils.js";

export const HOME_HELP = `usage: bitbucket-dc-axi [home] [flags]
description: Open pull requests of the repository from origin (newest 5)
flags[2]:
  -R/--repo <host>/<PROJECT>/<repo>, --json
examples[2]:
  bitbucket-dc-axi
  bitbucket-dc-axi home -R bitbucket.example.com/PROJ/repo --json
`;

const COMMANDS_HINT = "Run `bitbucket-dc-axi --help` for commands";

export async function homeCommand(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  noPositionals(parseArgs(args, [], "bitbucket-dc-axi home"), "bitbucket-dc-axi home");

  const token = ctx ? loadToken(ctx.host) : null;
  if (!ctx || (ctx.source === "foreign" && token !== null)) {
    return {
      repository: "not detected",
      pull_requests: [],
      help: [
        "Run `bitbucket-dc-axi pr list -R <host>/<PROJECT>/<repo>`",
        "Run `bitbucket-dc-axi config set --host <host>` in a terminal to add a server",
        COMMANDS_HINT,
      ],
    };
  }
  if (token === null) {
    return {
      repository: ctx.nwo,
      status: "not configured",
      pull_requests: [],
      help: [`Run \`bitbucket-dc-axi config set --host ${ctx.host}\` in a terminal`, COMMANDS_HINT],
    };
  }

  const page = object(
    await bitbucketRequest(ctx.host, `${repoPath(ctx)}/pull-requests`, {
      query: { state: "OPEN", limit: 5, order: "NEWEST" },
    }),
  );
  const rows = jsonArray(page["values"]).map((pr) => listRow(object(pr), []));
  const first = rows[0];
  return {
    repository: ctx.nwo,
    pull_requests: rows,
    help: [
      first
        ? `Run \`bitbucket-dc-axi pr view ${object(first)["id"]}${repoHint(ctx)}\` for details`
        : `Run \`bitbucket-dc-axi pr create --help\` to open one`,
      COMMANDS_HINT,
    ],
  };
}
