import { bitbucketRequest, type Json } from "../client.js";
import { loadCredentials } from "../credentials.js";
import type { RepoContext } from "../context.js";
import { drillHint, jsonArray, number, object, pipelineListRow, prListRow, repoHint, repoPath, text } from "./utils.js";

export async function homeCommand(_args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const creds = loadCredentials();
  if (!ctx) {
    return {
      repository: "not detected",
      auth: creds ? "configured" : "not configured",
      help: [
        "Run `bitbucket-axi repo view -R <workspace/repo>`",
        ...(creds ? [] : ["Run `bitbucket-axi config set` in a terminal"]),
        "Run `bitbucket-axi --help` for commands",
      ],
    };
  }
  if (!creds) {
    return {
      repository: ctx.nwo,
      auth: "not configured",
      help: [
        "Run `bitbucket-axi config set` in a terminal",
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
  const prsObject = object(prs);
  const pipelinesObject = object(pipelines);
  const prRows = jsonArray(prsObject["values"]).map((item) => prListRow(object(item), []));
  const pipelineRows = jsonArray(pipelinesObject["values"]).map((item) => pipelineListRow(object(item), []));
  return {
    repository: text(repoObject, "full_name") || ctx.nwo,
    open_pull_requests: prRows,
    recent_pipelines: pipelineRows,
    help: [
      prRows.length === 0
        ? `Run \`bitbucket-axi pr create --title "<title>" --source <branch>${repoHint(ctx)}\``
        : drillHint("pr list", "open pull requests", prRows.length, number(prsObject, "size"), ctx),
      pipelineRows.length === 0
        ? `Run \`bitbucket-axi pipeline run --branch <branch>${repoHint(ctx)}\``
        : drillHint("pipeline list", "pipelines", pipelineRows.length, number(pipelinesObject, "size"), ctx),
    ],
  };
}
