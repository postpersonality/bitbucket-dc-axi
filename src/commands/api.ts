import { AxiError } from "axi-sdk-js";
import { boolFlag, parseArgs, stringFlags } from "../args.js";
import { bitbucketRequest, type Json } from "../client.js";
import type { RepoContext } from "../context.js";
import { expandApiPath, parseApiFields, scalar, truncateJson } from "./utils.js";

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
