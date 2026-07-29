import { execFileSync } from "node:child_process";
import { AxiError } from "axi-sdk-js";
import { findRepoFlag } from "./args.js";

export interface RepoContext {
  workspace: string;
  repo: string;
  nwo: string;
  source: "flag" | "git";
}

export function resolveRepo(args: string[]): RepoContext | undefined {
  const explicit = findRepoFlag(args);
  if (explicit) return parseRepo(explicit, "flag");

  try {
    const remotes = execFileSync("git", ["remote", "-v"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of remotes.split("\n")) {
      const url = line.trim().split(/\s+/)[1];
      if (!url) continue;
      const parsed = parseBitbucketRemote(url);
      if (parsed) return parsed;
    }
  } catch {
    // Being outside a git repository is a normal CLI state.
  }
  return undefined;
}

export function parseBitbucketRemote(url: string): RepoContext | undefined {
  const scp = url.match(/^git@bitbucket\.org:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (scp) return context(scp[1]!, scp[2]!, "git");

  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "bitbucket.org") return undefined;
    const parts = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length !== 2) return undefined;
    return context(decodeURIComponent(parts[0]!), decodeURIComponent(parts[1]!), "git");
  } catch {
    return undefined;
  }
}

function parseRepo(value: string, source: RepoContext["source"]): RepoContext {
  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part))
  ) {
    throw new AxiError(`invalid repository: ${value}`, "VALIDATION_ERROR", [
      "Use `-R <workspace/repo>` with a Bitbucket workspace and repository slug",
    ]);
  }
  return context(parts[0], parts[1], source);
}

function context(
  workspace: string,
  repo: string,
  source: RepoContext["source"],
): RepoContext {
  return { workspace, repo, nwo: `${workspace}/${repo}`, source };
}
