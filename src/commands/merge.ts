import { parseArgs } from "../args.js";
import { bitbucketRequest, isObject, type Json } from "../client.js";
import { resolvePrTarget, type RepoContext } from "../context.js";
import { buildStats } from "./builds.js";
import { exactPositionals, jsonArray, number, object, prCore, prPath, text } from "./utils.js";

export const BLOCKER_ORDER = [
  "not_open",
  "draft",
  "conflicted",
  "vetoed",
  "mergeability_unknown",
  "builds",
  "open_blocker_comments",
];

// Read-only (REPO_READ): exit 0 even when blockers are present.
export async function mergeCheck(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const parsed = parseArgs(args, [], "bitbucket-dc-axi pr merge-check");
  exactPositionals(parsed, 1, "bitbucket-dc-axi pr merge-check <id|url>");
  const target = resolvePrTarget(parsed.positionals[0]!, ctx);
  const { host } = target.ctx;
  const path = prPath(target.ctx, target.id);

  const raw = object(await bitbucketRequest(host, path));
  const core = prCore(raw);
  const open = core.state === "open";
  const [mergeability, builds, comments] = await Promise.all([
    // The server answers 409 for /merge on a closed pull request.
    open ? bitbucketRequest(host, `${path}/merge`).then(object) : undefined,
    buildStats(host, core.head),
    bitbucketRequest(host, `${path}/blocker-comments`, { query: { states: "OPEN", limit: 1 } }).then(object),
  ]);

  const conflicted = mergeability ? mergeability["conflicted"] === true : null;
  const outcome = mergeability ? text(mergeability, "outcome") || null : null;
  const vetoes = mergeability
    ? jsonArray(mergeability["vetoes"]).filter(isObject).map((veto) => ({
        summary: text(veto, "summaryMessage"),
        detail: text(veto, "detailedMessage"),
      }))
    : null;
  const total = builds.successful + builds.failed + builds.inProgress + builds.cancelled + builds.unknown;
  const openBlockerComments = jsonArray(comments["values"]).length > 0;

  const failed: Record<string, boolean> = {
    not_open: !open,
    draft: core.draft,
    conflicted: conflicted === true,
    vetoed: (vetoes?.length ?? 0) > 0,
    mergeability_unknown: outcome === "UNKNOWN",
    builds: total === 0 || builds.successful < total,
    open_blocker_comments: openBlockerComments,
  };
  return {
    id: core.id,
    state: core.state,
    draft: core.draft,
    version: number(raw, "version") ?? 0,
    head: core.head,
    url: core.url,
    conflicted,
    outcome,
    vetoes,
    builds: { ...builds },
    open_blocker_comments: openBlockerComments,
    blockers: BLOCKER_ORDER.filter((blocker) => failed[blocker]),
  };
}
