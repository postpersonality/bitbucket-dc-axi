import { AxiError } from "axi-sdk-js";
import { stringFlag, type ParsedArgs } from "../args.js";
import { isObject, type Json, type JsonObject } from "../client.js";
import type { PrTarget, RepoContext } from "../context.js";

// Shared helpers for the command modules.

export const FULL_COMMIT = /^[0-9a-f]{40}$/i;

export const LIST_FIELDS = new Set(["source", "destination", "created", "url", "draft"]);

export interface PrCore {
  id: number;
  title: string;
  state: "open" | "merged" | "declined";
  draft: boolean;
  author: string;
  source: string;
  destination: string;
  head: string;
  url: string;
}

export function repoPath(ctx: RepoContext): string {
  return `api/1.0/projects/${encodeURIComponent(ctx.project)}/repos/${encodeURIComponent(ctx.slug)}`;
}

export function prPath(ctx: RepoContext, id: number): string {
  return `${repoPath(ctx)}/pull-requests/${id}`;
}

export function prCore(pr: JsonObject): PrCore {
  return {
    id: number(pr, "id") ?? 0,
    title: text(pr, "title"),
    state: text(pr, "state").toLowerCase() as PrCore["state"],
    // Absent before Bitbucket 9 (no draft PRs there).
    draft: pr["draft"] === true,
    author: nestedText(pr, "author", "user", "displayName") || nestedText(pr, "author", "user", "name"),
    source: nestedText(pr, "fromRef", "displayId"),
    destination: nestedText(pr, "toRef", "displayId"),
    head: nestedText(pr, "fromRef", "latestCommit"),
    url: selfUrl(pr),
  };
}

export function listRow(pr: JsonObject, fields: string[]): JsonObject {
  const core = prCore(pr);
  const row: JsonObject = { id: core.id, title: core.title, state: core.state, author: core.author };
  for (const field of fields) {
    if (field === "source") row[field] = core.source;
    if (field === "destination") row[field] = core.destination;
    if (field === "created") {
      const created = number(pr, "createdDate");
      row[field] = created === undefined ? "" : new Date(created).toISOString();
    }
    if (field === "url") row[field] = core.url;
    if (field === "draft") row[field] = core.draft;
  }
  return row;
}

// How a follow-up hint should name this pull request.
export function prRef(value: string, target: PrTarget): string {
  return target.byUrl ? value : `${target.id}${repoHint(target.ctx)}`;
}

export function repoHint(ctx: RepoContext): string {
  return ctx.source === "flag" ? ` -R ${ctx.nwo}` : "";
}

export function parseFields(value: string | undefined, allowed: Set<string>, command: string): string[] {
  if (!value) return [];
  const fields = value.split(",").map((field) => field.trim()).filter(Boolean);
  const invalid = fields.filter((field) => !allowed.has(field));
  if (invalid.length)
    throw new AxiError(`unknown --fields value: ${invalid.join(",")}`, "VALIDATION_ERROR", [
      `Valid fields for ${command}: ${[...allowed].join(",")}`,
    ]);
  return [...new Set(fields)];
}

// Cuts by code points so a surrogate pair is never split.
export function truncate(value: string, length: number): string {
  const chars = Array.from(value);
  return `${chars.slice(0, length).join("")}… (truncated, ${chars.length} chars total)`;
}

export function requiredFlag(parsed: ParsedArgs, name: string): string {
  const value = stringFlag(parsed, name);
  if (!value?.trim()) throw new AxiError(`${name} is required`, "VALIDATION_ERROR");
  return value;
}

export function positiveId(value: string, label: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value)))
    throw new AxiError(`${label} must be a positive integer`, "VALIDATION_ERROR");
  return Number(value);
}

export function noPositionals(parsed: ParsedArgs, command: string): void {
  if (parsed.positionals.length)
    throw new AxiError(`unexpected argument: ${parsed.positionals[0]}`, "VALIDATION_ERROR", [
      `Run \`${command} --help\``,
    ]);
}

export function exactPositionals(parsed: ParsedArgs, count: number, usage: string): void {
  if (parsed.positionals.length !== count)
    throw new AxiError(`expected ${count} argument${count === 1 ? "" : "s"}`, "VALIDATION_ERROR", [
      `Usage: ${usage}`,
    ]);
}

export function subcommandError(group: string, valid: string[], given?: string): AxiError {
  return new AxiError(
    given ? `unknown ${group} subcommand: ${given}` : `${group} subcommand is required`,
    "VALIDATION_ERROR",
    [`Valid subcommands: ${valid.join(", ")}`, `Run \`bitbucket-dc-axi ${group} --help\``],
  );
}

export function object(value: Json): JsonObject {
  if (!isObject(value)) throw new AxiError("Bitbucket returned an unexpected response", "API_ERROR");
  return value;
}

export function jsonArray(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

export function text(value: JsonObject, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

export function number(value: JsonObject, key: string): number | undefined {
  return typeof value[key] === "number" ? value[key] : undefined;
}

export function nestedText(value: JsonObject, ...keys: string[]): string {
  let current: Json | undefined = value;
  for (const key of keys) {
    if (!isObject(current)) return "";
    current = current[key];
  }
  return typeof current === "string" ? current : "";
}

// swagger 10.0 describes `links` without properties; servers send links.self[].href.
function selfUrl(pr: JsonObject): string {
  const links = pr["links"];
  const self = isObject(links) ? jsonArray(links["self"])[0] : undefined;
  return isObject(self) ? text(self, "href") : "";
}
