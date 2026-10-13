import { execFileSync } from "node:child_process";
import { AxiError } from "axi-sdk-js";
import { findRepoFlag } from "./args.js";
import { positiveId } from "./commands/utils.js";
import { loadToken } from "./credentials.js";

export interface RepoContext {
  host: string;
  project: string;
  slug: string;
  nwo: string;
  // "foreign": origin names a host but not a Bitbucket Data Center repository.
  source: "url" | "flag" | "git" | "foreign";
}

export interface PrTarget {
  ctx: RepoContext;
  id: number;
  byUrl: boolean;
}

// Host name with an optional port; no scheme or path.
export const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

const REPO_HINT = "Pass `-R <host>/<PROJECT>/<repo>` after the command";

export function resolveRepo(args: string[]): RepoContext | undefined {
  const explicit = findRepoFlag(args);
  if (explicit !== undefined) return parseRepoFlag(explicit);

  let origin: string;
  try {
    origin = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Outside a git repository, or no origin: a normal CLI state.
    return undefined;
  }
  return parseOrigin(origin);
}

export function parseOrigin(url: string): RepoContext | undefined {
  const scp = url.match(/^(?:([^@/:]+)@)?([^@/:]+):(?!\/\/)(.*)$/);
  if (scp) {
    const [, user, host, path] = scp;
    const parts = repoParts(path!);
    return user === "git" && parts ? context(host!, parts[0], parts[1], "git") : foreign(host!);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol === "file:" || !parsed.hostname) return undefined;
  if (parsed.protocol === "ssh:") {
    // The SSH port is not part of the Bitbucket host.
    const parts = repoParts(parsed.pathname.slice(1));
    return parts ? context(parsed.hostname, parts[0], parts[1], "git") : foreign(parsed.hostname);
  }
  if (parsed.protocol === "https:") {
    const scm = parsed.pathname.match(/^\/scm\/(.+)$/);
    const parts = scm ? repoParts(scm[1]!) : undefined;
    if (parts) return context(parsed.host, parts[0], parts[1], "git");
  }
  return foreign(parsed.host);
}

export function requireRepo(ctx?: RepoContext): RepoContext {
  if (!ctx) {
    throw new AxiError("No Bitbucket repository selected", "REPO_NOT_RESOLVED", [
      REPO_HINT,
      "Or run inside a clone whose origin is on Bitbucket Data Center",
    ]);
  }
  if (ctx.source !== "foreign") return ctx;
  if (loadToken(ctx.host) === null) {
    throw new AxiError(`No Bitbucket access token is configured for ${ctx.host}`, "NOT_CONFIGURED", [
      `Run \`bitbucket-dc-axi config set --host ${ctx.host}\` if it is a Bitbucket Data Center server`,
      REPO_HINT,
    ]);
  }
  throw new AxiError(`origin on ${ctx.host} is not a Bitbucket repository URL`, "REPO_NOT_RESOLVED", [
    REPO_HINT,
  ]);
}

export function resolvePrTarget(value: string, ctx?: RepoContext): PrTarget {
  const fromUrl = parsePrUrl(value);
  if (fromUrl) {
    if (ctx?.source === "flag") {
      throw new AxiError("A pull request URL cannot be combined with -R/--repo", "VALIDATION_ERROR", [
        "Pass either the pull request URL or `<id> -R <host>/<PROJECT>/<repo>`",
      ]);
    }
    return { ...fromUrl, byUrl: true };
  }
  const id = positiveId(value, "pull request id");
  return { ctx: requireRepo(ctx), id, byUrl: false };
}

function parsePrUrl(value: string): { ctx: RepoContext; id: number } | undefined {
  if (!/^https:\/\//i.test(value)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  const match = parsed.pathname.match(/^\/(projects|users)\/([^/]+)\/repos\/([^/]+)\/pull-requests\/([^/]+)(?:\/.*)?$/);
  if (!match) return undefined;
  const [, kind, owner, slug, id] = match;
  const host = parsed.host.toLowerCase();
  if (kind === "users") {
    throw new AxiError("Pull request URLs of personal repositories are not supported", "VALIDATION_ERROR", [
      `Pass the number instead: \`${id} -R ${host}/~${decode(owner!)}/${decode(slug!)}\``,
    ]);
  }
  return {
    ctx: context(host, decode(owner!), decode(slug!), "url"),
    id: positiveId(id!, "pull request id"),
  };
}

function parseRepoFlag(value: string): RepoContext {
  const parts = value.split("/");
  if (parts.length !== 3 || parts.some((part) => !part) || !HOST_PATTERN.test(parts[0]!)) {
    throw new AxiError(`invalid repository: ${value}`, "VALIDATION_ERROR", [
      "Use `-R <host>/<PROJECT>/<repo>`, e.g. `-R bitbucket.example.com/PROJ/repo`",
    ]);
  }
  return context(parts[0]!, parts[1]!, parts[2]!, "flag");
}

// `<key>/<slug>[.git]` with both segments present.
function repoParts(path: string): [string, string] | undefined {
  const parts = path.replace(/\.git$/, "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return [decode(parts[0]), decode(parts[1])];
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function context(host: string, project: string, slug: string, source: RepoContext["source"]): RepoContext {
  const lower = host.toLowerCase();
  return { host: lower, project, slug, nwo: `${lower}/${project}/${slug}`, source };
}

function foreign(host: string): RepoContext {
  const lower = host.toLowerCase();
  return { host: lower, project: "", slug: "", nwo: lower, source: "foreign" };
}
