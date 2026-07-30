import { boolFlag, parseArgs } from "../args.js";
import { bitbucketRequest, type Json } from "../client.js";
import type { RepoContext } from "../context.js";
import { compact, nestedText, noPositionals, number, object, repoPath, requireRepo, subcommandError, text, truncate } from "./utils.js";

export const REPO_HELP = `usage: bitbucket-axi repo view [flags]
description: Show the selected Bitbucket Cloud repository.
flags[2]:
  -R/--repo <workspace/repo>, --full
examples[2]:
  bitbucket-axi repo view
  bitbucket-axi repo view -R workspace/repo
`;

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
