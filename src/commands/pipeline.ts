import { AxiError } from "axi-sdk-js";
import { parseArgs, positiveInt, stringFlag } from "../args.js";
import { bitbucketRequest, type Json, type JsonObject } from "../client.js";
import type { RepoContext } from "../context.js";
import { exactPositionals, jsonArray, noPositionals, number, object, parseFields, pipelineDetail, pipelineListRow, repoHint, repoPath, requiredFlag, requireRepo, subcommandError, text } from "./utils.js";

export const PIPELINE_HELP = `usage: bitbucket-axi pipeline <subcommand> [flags]
subcommands[3]:
  list, view <uuid>, run
flags{list}:
  --status <name>, --limit <1-100> (default 30), --fields <creator,commit,created,completed,duration,url>, -R/--repo <workspace/repo>
flags{view}:
  -R/--repo <workspace/repo>
flags{run}:
  --branch <name>, --custom <pipeline-name>, -R/--repo <workspace/repo>
examples[3]:
  bitbucket-axi pipeline list
  bitbucket-axi pipeline view "{pipeline-uuid}"
  bitbucket-axi pipeline run --branch main
`;

const PIPELINE_LIST_FIELDS = new Set(["creator", "commit", "created", "completed", "duration", "url"]);

export async function pipelineCommand(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const subcommand = args[0];
  if (!subcommand) throw subcommandError("pipeline", ["list", "view", "run"]);
  if (subcommand === "list") return pipelineList(args.slice(1), requireRepo(ctx));
  if (subcommand === "view") return pipelineView(args.slice(1), requireRepo(ctx));
  if (subcommand === "run") return pipelineRun(args.slice(1), requireRepo(ctx));
  throw subcommandError("pipeline", ["list", "view", "run"], subcommand);
}

async function pipelineList(args: string[], ctx: RepoContext): Promise<Record<string, Json>> {
  const parsed = parseArgs(
    args,
    [{ name: "--status" }, { name: "--limit" }, { name: "--fields" }],
    "bitbucket-axi pipeline list",
  );
  noPositionals(parsed, "bitbucket-axi pipeline list");
  const limit = positiveInt(stringFlag(parsed, "--limit"), "--limit", 30);
  const extras = parseFields(stringFlag(parsed, "--fields"), PIPELINE_LIST_FIELDS, "pipeline list");
  const status = stringFlag(parsed, "--status");
  const payload = object(
    await bitbucketRequest(`${repoPath(ctx)}/pipelines`, {
      query: { pagelen: limit, sort: "-created_on", status: status?.toUpperCase() },
    }),
  );
  const values = jsonArray(payload["values"]);
  const rows = values.map((value) => pipelineListRow(object(value), extras));
  return {
    count: rows.length === 0
      ? `0${status ? ` ${status.toLowerCase()}` : ""} pipelines found in ${ctx.nwo}`
      : `${rows.length} of ${number(payload, "size") ?? rows.length} total`,
    pipelines: rows,
    help: rows.length === 0
      ? [`Run \`bitbucket-axi pipeline run --branch <branch>${repoHint(ctx)}\``]
      : [`Run \`bitbucket-axi pipeline view <uuid>${repoHint(ctx)}\``],
  };
}

async function pipelineView(args: string[], ctx: RepoContext): Promise<Record<string, Json>> {
  const parsed = parseArgs(args, [], "bitbucket-axi pipeline view");
  exactPositionals(parsed, 1, "bitbucket-axi pipeline view <uuid>");
  const id = parsed.positionals[0]!;
  if (!/^\{?[0-9a-f-]{8,}\}?$/i.test(id))
    throw new AxiError("pipeline uuid is invalid", "VALIDATION_ERROR", [
      "Copy the uuid from `bitbucket-axi pipeline list --fields uuid`",
    ]);
  const raw = object(await bitbucketRequest(`${repoPath(ctx)}/pipelines/${encodeURIComponent(id)}`));
  return { pipeline: pipelineDetail(raw) };
}

async function pipelineRun(args: string[], ctx: RepoContext): Promise<Record<string, Json>> {
  const parsed = parseArgs(
    args,
    [{ name: "--branch" }, { name: "--custom" }],
    "bitbucket-axi pipeline run",
  );
  noPositionals(parsed, "bitbucket-axi pipeline run");
  const branchName = requiredFlag(parsed, "--branch");
  const custom = stringFlag(parsed, "--custom");
  const target: JsonObject = {
    type: "pipeline_ref_target",
    ref_type: "branch",
    ref_name: branchName,
    ...(custom ? { selector: { type: "custom", pattern: custom } } : {}),
  };
  const raw = object(
    await bitbucketRequest(`${repoPath(ctx)}/pipelines`, {
      method: "POST",
      body: { target },
    }),
  );
  const uuid = text(raw, "uuid");
  return {
    pipeline: pipelineDetail(raw),
    ...(uuid ? { help: [`Run \`bitbucket-axi pipeline view ${uuid}${repoHint(ctx)}\``] } : {}),
  };
}
