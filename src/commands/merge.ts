import { AxiError } from "axi-sdk-js";
import { parseArgs } from "../args.js";
import { bitbucketRequest, BitbucketError, isObject, type Json } from "../client.js";
import { resolvePrTarget, type RepoContext } from "../context.js";
import { buildStats } from "./builds.js";
import { exactPositionals, FULL_COMMIT, jsonArray, number, object, prCore, prPath, prRef, requiredFlag, text, type PrCore } from "./utils.js";

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

// The merge body cannot carry a commit, so the head is checked before and after.
export async function merge(args: string[], ctx?: RepoContext): Promise<Record<string, Json>> {
  const parsed = parseArgs(args, [{ name: "--sha" }], "bitbucket-dc-axi pr merge");
  exactPositionals(parsed, 1, "bitbucket-dc-axi pr merge <id|url> --sha <commit>");
  const given = requiredFlag(parsed, "--sha");
  if (!FULL_COMMIT.test(given))
    throw new AxiError(`invalid --sha: ${given}`, "VALIDATION_ERROR", ["Pass the full 40-character commit hash"]);
  const sha = given.toLowerCase();
  const value = parsed.positionals[0]!;
  const target = resolvePrTarget(value, ctx);
  const ref = prRef(value, target);
  const { host } = target.ctx;
  const path = prPath(target.ctx, target.id);

  const raw = object(await bitbucketRequest(host, path));
  const core = prCore(raw);
  const head = core.head.toLowerCase();
  if (core.state === "merged" && head === sha) {
    return { id: core.id, state: "merged", head, url: core.url, already_merged: true };
  }
  if (core.state !== "open") {
    throw new BitbucketError(`Pull request ${core.id} is ${core.state}`, "NOT_OPEN", [`Run \`bitbucket-dc-axi pr view ${ref}\``], {
      state: core.state,
      head,
      sha: given,
    });
  }
  if (head !== sha) {
    throw new BitbucketError(`Pull request ${core.id} head is ${head}, not ${sha}`, "HEAD_MOVED", [
      `Run \`bitbucket-dc-axi pr merge-check ${ref}\` on the new head before merging it`,
    ], { state: "open", head, sha: given });
  }

  let merged: PrCore;
  try {
    merged = prCore(
      object(await bitbucketRequest(host, `${path}/merge`, { method: "POST", query: { version: number(raw, "version") ?? 0 }, body: {} })),
    );
  } catch (error) {
    if (error instanceof BitbucketError && error.extras["status"] === 409) {
      throw new BitbucketError("Bitbucket rejected the merge", "MERGE_REJECTED", [
        "See `details` and `vetoes` for the server's reason",
        `Run \`bitbucket-dc-axi pr merge-check ${ref}\``,
      ], error.extras);
    }
    throw error;
  }
  const mergedHead = merged.head.toLowerCase();
  if (mergedHead !== sha) {
    throw new BitbucketError(`Pull request ${core.id} was merged at ${mergedHead}, not ${sha}`, "MERGED_DIFFERENT_HEAD", [
      `Run \`bitbucket-dc-axi pr view ${ref}\``,
    ], { state: "merged", head: mergedHead, sha: given });
  }
  return { id: merged.id, state: "merged", head: mergedHead, url: merged.url || core.url, already_merged: false };
}
