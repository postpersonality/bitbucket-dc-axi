import { AxiError } from "axi-sdk-js";
import { boolFlag, parseArgs, positiveInt, stringFlag } from "../args.js";
import type { Handler } from "../cli.js";
import { bitbucketRequest, type Json, type JsonObject } from "../client.js";
import { requireRepo, resolvePrTarget, type RepoContext } from "../context.js";
import { buildStats, buildSummary } from "./builds.js";
import { mergeCheck } from "./merge.js";
import {
  exactPositionals,
  jsonArray,
  LIST_FIELDS,
  listRow,
  noPositionals,
  object,
  parseFields,
  prCore,
  prPath,
  prRef,
  repoHint,
  repoPath,
  requiredFlag,
  subcommandError,
  text,
  truncate,
} from "./utils.js";

export const PR_HELP = `usage: bitbucket-dc-axi pr <subcommand> [flags]
subcommands[4]:
  list, view <id|url>, create, merge-check <id|url>
flags{list}:
  --state <open|merged|declined|all> (default open), --limit <1-100> (default 30), --fields <source,destination,created,url,draft>, -R/--repo <host>/<PROJECT>/<repo>
flags{view}:
  --full, -R/--repo <host>/<PROJECT>/<repo> (not with a URL)
flags{create}:
  --title <text>, --source <branch>, --destination <branch> (default: repository default branch), --body <text>, -R/--repo <host>/<PROJECT>/<repo>
flags{merge-check}:
  -R/--repo <host>/<PROJECT>/<repo> (not with a URL); read-only, exit 0 even with blockers
examples[4]:
  bitbucket-dc-axi pr list --state all --fields url
  bitbucket-dc-axi pr view https://bitbucket.example.com/projects/PROJ/repos/repo/pull-requests/7 --json
  bitbucket-dc-axi pr create --title "Fix login" --source fix/login --body "- fixes the login form"
  bitbucket-dc-axi pr merge-check 7 --json
`;

const DESCRIPTION_LIMIT = 700;
const STATES = ["open", "merged", "declined", "all"];

export const SUBCOMMANDS: Record<string, Handler> = {
  list: prList,
  view: prView,
  create: prCreate,
  "merge-check": mergeCheck,
};

export async function prCommand(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const subcommand = args[0];
  const handler = subcommand === undefined ? undefined : SUBCOMMANDS[subcommand];
  if (!handler) throw subcommandError("pr", Object.keys(SUBCOMMANDS), subcommand);
  return handler(args.slice(1), ctx);
}

async function prList(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const command = "bitbucket-dc-axi pr list";
  const parsed = parseArgs(args, [{ name: "--state" }, { name: "--limit" }, { name: "--fields" }], command);
  noPositionals(parsed, command);
  const state = (stringFlag(parsed, "--state") ?? "open").toLowerCase();
  if (!STATES.includes(state))
    throw new AxiError(`invalid --state: ${state}`, "VALIDATION_ERROR", [`Use ${STATES.join(", ")}`]);
  const limit = positiveInt(stringFlag(parsed, "--limit"), "--limit", 30);
  const fields = parseFields(stringFlag(parsed, "--fields"), LIST_FIELDS, "pr list");
  const repo = requireRepo(ctx);

  const page = object(
    await bitbucketRequest(repo.host, `${repoPath(repo)}/pull-requests`, {
      query: { state: state.toUpperCase(), limit, order: "NEWEST" },
    }),
  );
  const rows = jsonArray(page["values"]).map((pr) => listRow(object(pr), fields));
  return {
    count: rows.length,
    pull_requests: rows,
    help: [
      rows.length
        ? `Run \`bitbucket-dc-axi pr view <id>${repoHint(repo)}\``
        : `Run \`bitbucket-dc-axi pr create --title "<title>" --source <branch>${repoHint(repo)}\``,
    ],
  };
}

async function prView(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const parsed = parseArgs(args, [{ name: "--full", boolean: true }], "bitbucket-dc-axi pr view");
  exactPositionals(parsed, 1, "bitbucket-dc-axi pr view <id|url>");
  const value = parsed.positionals[0]!;
  const target = resolvePrTarget(value, ctx);

  const raw = object(await bitbucketRequest(target.ctx.host, prPath(target.ctx, target.id)));
  const core = prCore(raw);
  const counts = await buildStats(target.ctx.host, core.head);
  const description = text(raw, "description");
  const truncated = !boolFlag(parsed, "--full") && Array.from(description).length > DESCRIPTION_LIMIT;
  return {
    ...core,
    description: truncated ? truncate(description, DESCRIPTION_LIMIT) : description,
    builds: buildSummary(counts),
    ...(truncated ? { help: [`Run \`bitbucket-dc-axi pr view ${prRef(value, target)} --full\``] } : {}),
  };
}

async function prCreate(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const command = "bitbucket-dc-axi pr create";
  const parsed = parseArgs(
    args,
    [{ name: "--title" }, { name: "--source" }, { name: "--destination" }, { name: "--body" }],
    command,
  );
  noPositionals(parsed, command);
  const title = requiredFlag(parsed, "--title");
  const source = requiredFlag(parsed, "--source");
  const destination = stringFlag(parsed, "--destination");
  const description = stringFlag(parsed, "--body");
  const repo = requireRepo(ctx);

  const toId = destination
    ? branchRef(destination)
    : text(object(await bitbucketRequest(repo.host, `${repoPath(repo)}/default-branch`)), "id");
  const repository: JsonObject = { slug: repo.slug, project: { key: repo.project } };
  const body: JsonObject = {
    title,
    ...(description ? { description } : {}),
    fromRef: { id: branchRef(source), repository },
    toRef: { id: toId, repository },
  };
  const core = prCore(object(await bitbucketRequest(repo.host, `${repoPath(repo)}/pull-requests`, { method: "POST", body })));
  return {
    id: core.id,
    url: core.url,
    title: core.title,
    source: core.source,
    destination: core.destination,
    state: core.state,
    help: [`Run \`bitbucket-dc-axi pr view ${core.id}${repoHint(repo)}\``],
  };
}

function branchRef(name: string): string {
  return name.startsWith("refs/") ? name : `refs/heads/${name}`;
}
