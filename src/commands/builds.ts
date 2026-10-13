import { AxiError } from "axi-sdk-js";
import { parseArgs } from "../args.js";
import { bitbucketRequest, type ErrorHelp, type Json } from "../client.js";
import { requireRepo, type RepoContext } from "../context.js";
import { exactPositionals, FULL_COMMIT, jsonArray, number, object, text } from "./utils.js";

export const BUILDS_HELP = `usage: bitbucket-dc-axi builds <commit> [flags]
description: All build statuses reported for a commit (full 40-character hash)
flags[2]:
  -R/--repo <host>/<PROJECT>/<repo>, --json
examples[2]:
  bitbucket-dc-axi builds 0123456789abcdef0123456789abcdef01234567
  bitbucket-dc-axi builds 0123456789abcdef0123456789abcdef01234567 -R bitbucket.example.com/PROJ/repo --json
`;

const COMMIT_HELP: ErrorHelp = { notFound: ["Check the repository selector and the full 40-character commit hash"] };

export interface BuildCounts {
  successful: number;
  failed: number;
  inProgress: number;
  cancelled: number;
  unknown: number;
}

export async function buildStats(host: string, commit: string, help?: ErrorHelp): Promise<BuildCounts> {
  const stats = object(await bitbucketRequest(host, `build-status/latest/commits/stats/${commit}`, { help }));
  return {
    successful: number(stats, "successful") ?? 0,
    failed: number(stats, "failed") ?? 0,
    inProgress: number(stats, "inProgress") ?? 0,
    cancelled: number(stats, "cancelled") ?? 0,
    unknown: number(stats, "unknown") ?? 0,
  };
}

export function buildSummary(counts: BuildCounts): string {
  const total = counts.successful + counts.failed + counts.inProgress + counts.cancelled + counts.unknown;
  if (total === 0) return "no builds";
  const parts = [`${counts.successful}/${total} passed`];
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.inProgress) parts.push(`${counts.inProgress} running`);
  if (counts.cancelled) parts.push(`${counts.cancelled} cancelled`);
  if (counts.unknown) parts.push(`${counts.unknown} unknown`);
  return parts.join(", ");
}

export async function buildsCommand(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const usage = "bitbucket-dc-axi builds <commit>";
  const parsed = parseArgs(args, [], "bitbucket-dc-axi builds");
  exactPositionals(parsed, 1, usage);
  const commit = parsed.positionals[0]!.toLowerCase();
  if (!FULL_COMMIT.test(commit))
    throw new AxiError(`invalid commit: ${parsed.positionals[0]}`, "VALIDATION_ERROR", [
      "Pass the full 40-character commit hash",
    ]);
  const { host } = requireRepo(ctx);

  const [builds, counts] = await Promise.all([buildList(host, commit), buildStats(host, commit, COMMIT_HELP)]);
  return { commit, builds, summary: buildSummary(counts), counts: { ...counts } };
}

async function buildList(host: string, commit: string): Promise<Json[]> {
  const builds: Json[] = [];
  let start: number | undefined = 0;
  while (start !== undefined) {
    const page = object(
      await bitbucketRequest(host, `build-status/latest/commits/${commit}`, { query: { limit: 100, start }, help: COMMIT_HELP }),
    );
    for (const value of jsonArray(page["values"])) {
      const build = object(value);
      builds.push({ key: text(build, "key"), name: text(build, "name"), state: text(build, "state"), url: text(build, "url") });
    }
    start = page["isLastPage"] === true ? undefined : number(page, "nextPageStart");
  }
  return builds;
}
