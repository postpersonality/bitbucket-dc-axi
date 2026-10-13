import { parseArgs } from "../args.js";
import { bitbucketRequest, type Json } from "../client.js";
import { requireRepo, type RepoContext } from "../context.js";
import { jsonArray, listRow, noPositionals, object, repoHint, repoPath } from "./utils.js";

export const HOME_HELP = `usage: bitbucket-dc-axi [home] [flags]
description: Open pull requests of the repository from origin (newest 5); hints outside a repository; a host without a token or a non-Bitbucket origin fails as in pr list
flags[2]:
  -R/--repo <host>/<PROJECT>/<repo>, --json
examples[2]:
  bitbucket-dc-axi
  bitbucket-dc-axi home -R bitbucket.example.com/PROJ/repo --json
`;

const COMMANDS_HINT = "Run `bitbucket-dc-axi --help` for commands";

export async function homeCommand(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  noPositionals(parseArgs(args, [], "bitbucket-dc-axi home"), "bitbucket-dc-axi home");

  if (!ctx) {
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
  const repo = requireRepo(ctx);

  const page = object(
    await bitbucketRequest(repo.host, `${repoPath(repo)}/pull-requests`, {
      query: { state: "OPEN", limit: 5, order: "NEWEST" },
    }),
  );
  const rows = jsonArray(page["values"]).map((pr) => listRow(object(pr), []));
  const first = rows[0];
  return {
    repository: repo.nwo,
    pull_requests: rows,
    help: [
      first
        ? `Run \`bitbucket-dc-axi pr view ${object(first)["id"]}${repoHint(repo)}\` for details`
        : `Run \`bitbucket-dc-axi pr create --help\` to open one`,
      COMMANDS_HINT,
    ],
  };
}
