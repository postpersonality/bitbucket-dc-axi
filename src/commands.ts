import { AxiError } from "axi-sdk-js";
import {
  boolFlag,
  parseArgs,
  positiveInt,
  stringFlag,
  stringFlags,
  type ParsedArgs,
} from "./args.js";
import { bitbucketRequest, isObject, validateCredentials, type Json, type JsonObject } from "./client.js";
import { clearCredentials, isValidEmail, loadCredentials, saveCredentials } from "./credentials.js";
import type { RepoContext } from "./context.js";

export const REPO_HELP = `usage: bitbucket-axi repo view [flags]
description: Show the selected Bitbucket Cloud repository.
flags[2]:
  -R/--repo <workspace/repo>, --full
examples[2]:
  bitbucket-axi repo view
  bitbucket-axi repo view -R workspace/repo
`;

export const PR_HELP = `usage: bitbucket-axi pr <subcommand> [flags]
subcommands[3]:
  list, view <id>, create
flags{list}:
  --state <open|merged|declined|superseded|all> (default open), --limit <1-100> (default 30), --fields <source,destination,created,url,draft,comments>, -R/--repo <workspace/repo>
flags{view}:
  --full, -R/--repo <workspace/repo>
flags{create}:
  --title <text>, --source <branch>, --destination <branch>, --body <text>, --close-source, -R/--repo <workspace/repo>
examples[3]:
  bitbucket-axi pr list --state open
  bitbucket-axi pr view 42 --full
  bitbucket-axi pr create --title "Fix auth" --source fix/auth --destination main
`;

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

export const API_HELP = `usage: bitbucket-axi api [<method>] <path> [flags]
description: Make an authenticated Bitbucket Cloud REST API v2.0 request.
methods[6]:
  GET, POST, PUT, PATCH, DELETE, HEAD
flags[3]:
  --field <key=value> (repeatable), --full, -R/--repo <workspace/repo>
examples[3]:
  bitbucket-axi api /repositories/{workspace}/{repo}
  bitbucket-axi api GET /user
  bitbucket-axi api GET /repositories/{workspace}/{repo}/refs/branches --field pagelen=10
`;

export const CONFIG_HELP = `usage: bitbucket-axi config <subcommand> [flags]
description: Manage Bitbucket Cloud API credentials stored in the OS credential manager.
subcommands[3]:
  set, status, clear
flags{set}:
  --email <atlassian-account-email> (required), --token-stdin (read API token from stdin)
flags{status}:
  (none)
flags{clear}:
  (none)
examples[3]:
  bitbucket-axi config set --email you@example.com --token-stdin
  bitbucket-axi config status
  bitbucket-axi config clear
`;

const PR_LIST_FIELDS = new Set(["source", "destination", "created", "url", "draft", "comments"]);
const PIPELINE_LIST_FIELDS = new Set(["creator", "commit", "created", "completed", "duration", "url"]);

export async function repoCommand(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const subcommand = args[0];
  if (!subcommand) throw subcommandError("repo", ["view"]);
  if (subcommand !== "view") throw subcommandError("repo", ["view"], subcommand);
  const parsed = parseArgs(args.slice(1), [{ name: "--full", boolean: true }], "bitbucket-axi repo view");
  noPositionals(parsed, "bitbucket-axi repo view");
  const repo = requireRepo(ctx);
  const raw = object(await bitbucketRequest(repoPath(repo)));
  const description = text(raw, "description");
  const truncated = !boolFlag(parsed, "--full") && description.length > 700;
  return {
    repository: compact({
      name: text(raw, "full_name") || repo.nwo,
      private: raw["is_private"] === true ? "yes" : "no",
      main_branch: nestedText(raw, "mainbranch", "name") || "none",
      language: text(raw, "language") || "none",
      size_bytes: number(raw, "size"),
      url: nestedText(raw, "links", "html", "href"),
      description: truncated ? truncate(description, 700) : description || "none",
    }),
    ...(truncated ? { help: ["Run `bitbucket-axi repo view --full` to see the complete description"] } : {}),
  };
}

export async function prCommand(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const subcommand = args[0];
  if (!subcommand) throw subcommandError("pr", ["list", "view", "create"]);
  if (subcommand === "list") return prList(args.slice(1), requireRepo(ctx));
  if (subcommand === "view") return prView(args.slice(1), requireRepo(ctx));
  if (subcommand === "create") return prCreate(args.slice(1), requireRepo(ctx));
  throw subcommandError("pr", ["list", "view", "create"], subcommand);
}

async function prList(args: string[], ctx: RepoContext): Promise<Record<string, Json>> {
  const parsed = parseArgs(
    args,
    [
      { name: "--state" },
      { name: "--limit" },
      { name: "--fields" },
    ],
    "bitbucket-axi pr list",
  );
  noPositionals(parsed, "bitbucket-axi pr list");
  const state = (stringFlag(parsed, "--state") ?? "open").toLowerCase();
  if (!["open", "merged", "declined", "superseded", "all"].includes(state))
    throw new AxiError(`invalid --state: ${state}`, "VALIDATION_ERROR", [
      "Use open, merged, declined, superseded, or all",
    ]);
  const limit = positiveInt(stringFlag(parsed, "--limit"), "--limit", 30);
  const extras = parseFields(stringFlag(parsed, "--fields"), PR_LIST_FIELDS, "pr list");
  const payload = object(
    await bitbucketRequest(`${repoPath(ctx)}/pullrequests`, {
      query: {
        pagelen: limit,
        sort: "-updated_on",
        state: state === "all" ? undefined : state.toUpperCase(),
      },
    }),
  );
  const values = jsonArray(payload["values"]);
  const rows = values.map((value) => prListRow(object(value), extras));
  const description = state === "all" ? "pull requests" : `${state} pull requests`;
  return {
    count: rows.length === 0
      ? `0 ${description} found in ${ctx.nwo}`
      : `${rows.length} of ${number(payload, "size") ?? rows.length} total`,
    pull_requests: rows,
    help: rows.length === 0
      ? [`Run \`bitbucket-axi pr create --title "<title>" --source <branch>${repoHint(ctx)}\``]
      : [`Run \`bitbucket-axi pr view <id>${repoHint(ctx)}\``],
  };
}

async function prView(args: string[], ctx: RepoContext): Promise<Record<string, Json>> {
  const parsed = parseArgs(args, [{ name: "--full", boolean: true }], "bitbucket-axi pr view");
  exactPositionals(parsed, 1, "bitbucket-axi pr view <id>");
  const id = positiveId(parsed.positionals[0]!, "pull request id");
  const raw = object(await bitbucketRequest(`${repoPath(ctx)}/pullrequests/${id}`));
  const description = text(raw, "description");
  const truncated = !boolFlag(parsed, "--full") && description.length > 700;
  return {
    pull_request: compact({
      id: number(raw, "id") ?? id,
      title: text(raw, "title"),
      state: text(raw, "state").toLowerCase(),
      author: actor(raw["author"]),
      source: branch(raw, "source"),
      destination: branch(raw, "destination"),
      draft: raw["draft"] === true ? "yes" : "no",
      comments: number(raw, "comment_count") ?? 0,
      created: text(raw, "created_on"),
      updated: text(raw, "updated_on"),
      url: nestedText(raw, "links", "html", "href"),
      description: truncated ? truncate(description, 700) : description || "none",
    }),
    ...(truncated ? { help: [`Run \`bitbucket-axi pr view ${id} --full${repoHint(ctx)}\``] } : {}),
  };
}

async function prCreate(args: string[], ctx: RepoContext): Promise<Record<string, Json>> {
  const parsed = parseArgs(
    args,
    [
      { name: "--title" },
      { name: "--source" },
      { name: "--destination" },
      { name: "--body" },
      { name: "--close-source", boolean: true },
    ],
    "bitbucket-axi pr create",
  );
  noPositionals(parsed, "bitbucket-axi pr create");
  const title = requiredFlag(parsed, "--title");
  const source = requiredFlag(parsed, "--source");
  const destination = stringFlag(parsed, "--destination");
  const body: JsonObject = {
    title,
    source: { branch: { name: source } },
    ...(destination ? { destination: { branch: { name: destination } } } : {}),
    ...(stringFlag(parsed, "--body") ? { description: stringFlag(parsed, "--body")! } : {}),
    ...(boolFlag(parsed, "--close-source") ? { close_source_branch: true } : {}),
  };
  const raw = object(await bitbucketRequest(`${repoPath(ctx)}/pullrequests`, { method: "POST", body }));
  const id = number(raw, "id");
  return {
    pull_request: compact({
      id,
      title: text(raw, "title") || title,
      state: text(raw, "state").toLowerCase() || "open",
      source: branch(raw, "source") || source,
      destination: branch(raw, "destination") || destination || "default branch",
      url: nestedText(raw, "links", "html", "href"),
    }),
    ...(id !== undefined ? { help: [`Run \`bitbucket-axi pr view ${id}${repoHint(ctx)}\``] } : {}),
  };
}

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

export async function apiCommand(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const parsed = parseArgs(
    args,
    [
      { name: "--field", repeatable: true },
      { name: "--full", boolean: true },
    ],
    "bitbucket-axi api",
  );
  const positionals = [...parsed.positionals];
  const first = positionals[0]?.toUpperCase();
  const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
  const method = first && methods.has(first) ? positionals.shift()!.toUpperCase() : "GET";
  if (positionals.length !== 1)
    throw new AxiError("api requires exactly one relative path", "VALIDATION_ERROR", [
      "Run `bitbucket-axi api --help`",
    ]);
  const path = expandApiPath(positionals[0]!, ctx);
  const fields = parseApiFields(stringFlags(parsed, "--field"));
  const query = method === "GET" || method === "HEAD"
    ? Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, scalar(value)]))
    : undefined;
  const payload = await bitbucketRequest(path, {
    method,
    ...(query ? { query } : {}),
    ...(query ? {} : { body: fields }),
  });
  const full = boolFlag(parsed, "--full");
  const truncated = truncateJson(payload, full);
  return {
    api_response: truncated.value,
    ...(truncated.changed ? { help: ["Run the same command with `--full` for complete string values"] } : {}),
  };
}

export async function configCommand(args: string[]): Promise<Record<string, Json>> {
  const subcommand = args[0];
  if (!subcommand) throw subcommandError("config", ["set", "status", "clear"]);
  if (subcommand === "set") return configSet(args.slice(1));
  if (subcommand === "status") return configStatus(args.slice(1));
  if (subcommand === "clear") return configClear(args.slice(1));
  throw subcommandError("config", ["set", "status", "clear"], subcommand);
}

export async function configSet(
  args: string[],
  readToken: () => Promise<string> = readTokenFromStdin,
): Promise<Record<string, Json>> {
  const parsed = parseArgs(
    args,
    [{ name: "--email" }, { name: "--token-stdin", boolean: true }],
    "bitbucket-axi config set",
  );
  noPositionals(parsed, "bitbucket-axi config set");
  const email = requiredFlag(parsed, "--email");
  if (!isValidEmail(email))
    throw new AxiError(`invalid email: ${email}`, "VALIDATION_ERROR", [
      "Use your Atlassian account email address",
    ]);
  if (!boolFlag(parsed, "--token-stdin"))
    throw new AxiError("--token-stdin is required", "VALIDATION_ERROR", [
      "Pipe the API token via stdin: `bitbucket-axi config set --email <email> --token-stdin`",
    ]);
  const token = (await readToken()).trim();
  if (!token)
    throw new AxiError("no API token received on stdin", "VALIDATION_ERROR", [
      "Pipe the API token via stdin: `echo <token> | bitbucket-axi config set --email <email> --token-stdin`",
    ]);
  await validateCredentials(email, token);
  saveCredentials({ email, token });
  return {
    config: { email, status: "configured" },
    help: [
      "Run `bitbucket-axi config status` to verify",
      "Run `bitbucket-axi repo view -R <workspace/repo>` to use the CLI",
    ],
  };
}

export async function configStatus(args: string[]): Promise<Record<string, Json>> {
  const parsed = parseArgs(args, [], "bitbucket-axi config status");
  noPositionals(parsed, "bitbucket-axi config status");
  const creds = loadCredentials();
  if (!creds) {
    return {
      config: { ready: false },
      help: ["Run `bitbucket-axi config set --email <email> --token-stdin`"],
    };
  }
  return { config: { email: creds.email, ready: true } };
}

export async function configClear(args: string[]): Promise<Record<string, Json>> {
  const parsed = parseArgs(args, [], "bitbucket-axi config clear");
  noPositionals(parsed, "bitbucket-axi config clear");
  const present = loadCredentials() !== null;
  clearCredentials();
  return { config: { status: present ? "cleared" : "already clear" } };
}

const MAX_TOKEN_BYTES = 8192;

export async function readTokenFromStdin(
  stream: NodeJS.ReadableStream = process.stdin,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_TOKEN_BYTES) {
      throw new AxiError("API token on stdin is too large", "VALIDATION_ERROR", [
        "Pipe a single valid Bitbucket API token via stdin",
      ]);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function homeCommand(_args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const creds = loadCredentials();
  if (!ctx) {
    return {
      repository: "not detected",
      auth: creds ? "configured" : "not configured",
      help: [
        "Run `bitbucket-axi repo view -R <workspace/repo>`",
        ...(creds ? [] : ["Run `bitbucket-axi config set --email <email> --token-stdin`"]),
        "Run `bitbucket-axi --help` for commands",
      ],
    };
  }
  if (!creds) {
    return {
      repository: ctx.nwo,
      auth: "not configured",
      help: [
        "Run `bitbucket-axi config set --email <email> --token-stdin`",
        "Run `bitbucket-axi --help` for commands",
      ],
    };
  }

  const [repo, prs, pipelines] = await Promise.all([
    bitbucketRequest(repoPath(ctx)),
    bitbucketRequest(`${repoPath(ctx)}/pullrequests`, { query: { state: "OPEN", pagelen: 3, sort: "-updated_on" } }),
    bitbucketRequest(`${repoPath(ctx)}/pipelines`, { query: { pagelen: 3, sort: "-created_on" } }),
  ]);
  const repoObject = object(repo);
  const prRows = jsonArray(object(prs)["values"]).map((item) => prListRow(object(item), []));
  const pipelineRows = jsonArray(object(pipelines)["values"]).map((item) => pipelineListRow(object(item), []));
  return {
    repository: text(repoObject, "full_name") || ctx.nwo,
    open_pull_requests: prRows,
    recent_pipelines: pipelineRows,
    help: [
      `Run \`bitbucket-axi pr list${repoHint(ctx)}\``,
      `Run \`bitbucket-axi pipeline list${repoHint(ctx)}\``,
    ],
  };
}

function prListRow(raw: JsonObject, extras: string[]): JsonObject {
  const row: JsonObject = compact({
    id: number(raw, "id"),
    title: text(raw, "title"),
    state: text(raw, "state").toLowerCase(),
    author: actor(raw["author"]),
  });
  for (const extra of extras) {
    if (extra === "source") row[extra] = branch(raw, "source");
    if (extra === "destination") row[extra] = branch(raw, "destination");
    if (extra === "created") row[extra] = text(raw, "created_on");
    if (extra === "url") row[extra] = nestedText(raw, "links", "html", "href");
    if (extra === "draft") row[extra] = raw["draft"] === true ? "yes" : "no";
    if (extra === "comments") row[extra] = number(raw, "comment_count") ?? 0;
  }
  return row;
}

function pipelineListRow(raw: JsonObject, extras: string[]): JsonObject {
  const row: JsonObject = compact({
    uuid: text(raw, "uuid"),
    build: number(raw, "build_number"),
    state: pipelineState(raw),
    branch: nestedText(raw, "target", "ref_name") || "none",
  });
  for (const extra of extras) {
    if (extra === "creator") row[extra] = actor(raw["creator"]);
    if (extra === "created") row[extra] = text(raw, "created_on");
    if (extra === "commit") row[extra] = nestedText(raw, "target", "commit", "hash").slice(0, 12);
    if (extra === "completed") row[extra] = text(raw, "completed_on") || "pending";
    if (extra === "duration") row[extra] = number(raw, "build_seconds_used") ?? 0;
    if (extra === "url") row[extra] = nestedText(raw, "links", "html", "href");
  }
  return row;
}

function pipelineDetail(raw: JsonObject): JsonObject {
  return compact({
    uuid: text(raw, "uuid"),
    build: number(raw, "build_number"),
    state: pipelineState(raw),
    branch: nestedText(raw, "target", "ref_name") || "none",
    commit: nestedText(raw, "target", "commit", "hash").slice(0, 12) || "none",
    creator: actor(raw["creator"]),
    created: text(raw, "created_on"),
    completed: text(raw, "completed_on") || "pending",
    duration_seconds: number(raw, "build_seconds_used") ?? 0,
    url: nestedText(raw, "links", "html", "href"),
  });
}

function pipelineState(raw: JsonObject): string {
  return (
    nestedText(raw, "state", "result", "name") ||
    nestedText(raw, "state", "name") ||
    "unknown"
  ).toLowerCase();
}

function repoPath(ctx: RepoContext): string {
  return `repositories/${encodeURIComponent(ctx.workspace)}/${encodeURIComponent(ctx.repo)}`;
}

function requireRepo(ctx?: RepoContext): RepoContext {
  if (ctx) return ctx;
  throw new AxiError("no Bitbucket repository selected", "VALIDATION_ERROR", [
    "Run inside a repository with a bitbucket.org git remote or pass `-R <workspace/repo>`",
  ]);
}

function repoHint(ctx: RepoContext): string {
  return ctx.source === "flag" ? ` -R ${ctx.nwo}` : "";
}

function parseFields(value: string | undefined, allowed: Set<string>, command: string): string[] {
  if (!value) return [];
  const fields = value.split(",").map((field) => field.trim()).filter(Boolean);
  const invalid = fields.filter((field) => !allowed.has(field));
  if (invalid.length)
    throw new AxiError(`unknown --fields value: ${invalid.join(",")}`, "VALIDATION_ERROR", [
      `Valid fields for ${command}: ${[...allowed].join(",")}`,
    ]);
  return [...new Set(fields)];
}

function parseApiFields(values: string[]): JsonObject {
  const result: JsonObject = {};
  for (const field of values) {
    const equals = field.indexOf("=");
    if (equals < 1) throw new AxiError(`invalid --field: ${field}`, "VALIDATION_ERROR", [
      "Use `--field key=value`",
    ]);
    const key = field.slice(0, equals);
    if (!/^[A-Za-z0-9_.-]+$/.test(key))
      throw new AxiError(`invalid field name: ${key}`, "VALIDATION_ERROR");
    if (key in result)
      throw new AxiError(`--field ${key} may only be given once`, "VALIDATION_ERROR");
    result[key] = parseScalar(field.slice(equals + 1));
  }
  return result;
}

function parseScalar(value: string): Json {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("{") || value.startsWith("[")) {
    try { return JSON.parse(value) as Json; } catch {
      throw new AxiError("--field contains invalid JSON", "VALIDATION_ERROR");
    }
  }
  return value;
}

function scalar(value: Json): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function expandApiPath(path: string, ctx?: RepoContext): string {
  if (!path.includes("{")) return path;
  const repo = requireRepo(ctx);
  const expanded = path
    .replaceAll("{workspace}", encodeURIComponent(repo.workspace))
    .replaceAll("{repo}", encodeURIComponent(repo.repo))
    .replaceAll("{repo_slug}", encodeURIComponent(repo.repo));
  if (expanded.includes("{"))
    throw new AxiError("API path contains an unknown placeholder", "VALIDATION_ERROR", [
      "Supported placeholders: {workspace}, {repo}, {repo_slug}",
    ]);
  return expanded;
}

function truncateJson(value: Json, full: boolean): { value: Json; changed: boolean } {
  if (full) return { value, changed: false };
  if (typeof value === "string") {
    return value.length > 2000
      ? { value: truncate(value, 2000), changed: true }
      : { value, changed: false };
  }
  if (Array.isArray(value)) {
    const children = value.map((item) => truncateJson(item, false));
    return { value: children.map((item) => item.value), changed: children.some((item) => item.changed) };
  }
  if (isObject(value)) {
    let changed = false;
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      const child = truncateJson(item, false);
      result[key] = child.value;
      changed ||= child.changed;
    }
    return { value: result, changed };
  }
  return { value, changed: false };
}

function truncate(value: string, length: number): string {
  return `${value.slice(0, length)}… (truncated, ${value.length} chars total)`;
}

function requiredFlag(parsed: ParsedArgs, name: string): string {
  const value = stringFlag(parsed, name);
  if (!value?.trim()) throw new AxiError(`${name} is required`, "VALIDATION_ERROR");
  return value;
}

function positiveId(value: string, label: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1)
    throw new AxiError(`${label} must be a positive integer`, "VALIDATION_ERROR");
  return Number(value);
}

function noPositionals(parsed: ParsedArgs, command: string): void {
  if (parsed.positionals.length)
    throw new AxiError(`unexpected argument: ${parsed.positionals[0]}`, "VALIDATION_ERROR", [
      `Run \`${command} --help\``,
    ]);
}

function exactPositionals(parsed: ParsedArgs, count: number, usage: string): void {
  if (parsed.positionals.length !== count)
    throw new AxiError(`expected ${count} argument${count === 1 ? "" : "s"}`, "VALIDATION_ERROR", [
      `Usage: ${usage}`,
    ]);
}

function subcommandError(group: string, valid: string[], given?: string): AxiError {
  return new AxiError(
    given ? `unknown ${group} subcommand: ${given}` : `${group} subcommand is required`,
    "VALIDATION_ERROR",
    [`Valid subcommands: ${valid.join(", ")}`, `Run \`bitbucket-axi ${group} --help\``],
  );
}

function object(value: Json): JsonObject {
  if (!isObject(value)) throw new AxiError("Bitbucket returned an unexpected response", "API_ERROR");
  return value;
}

function jsonArray(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function compact(values: Record<string, Json | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as JsonObject;
}

function text(value: JsonObject, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

function number(value: JsonObject, key: string): number | undefined {
  return typeof value[key] === "number" ? value[key] : undefined;
}

function nestedText(value: JsonObject, ...keys: string[]): string {
  let current: Json | undefined = value;
  for (const key of keys) {
    if (!isObject(current)) return "";
    current = current[key];
  }
  return typeof current === "string" ? current : "";
}

function branch(value: JsonObject, side: "source" | "destination"): string {
  return nestedText(value, side, "branch", "name");
}

function actor(value: Json | undefined): string {
  if (!isObject(value)) return "unknown";
  return text(value, "display_name") || text(value, "nickname") || text(value, "username") || "unknown";
}
