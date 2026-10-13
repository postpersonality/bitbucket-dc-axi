import { AxiError } from "axi-sdk-js";
import { loadToken } from "./credentials.js";

export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}

// Hints a command puts in place of the default 401 and 404 hints, which fit the commands that take a pull request number.
export interface ErrorHelp {
  auth?: string[];
  notFound?: string[];
}

interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: Json;
  help?: ErrorHelp;
}

interface ServerReply {
  status: number;
  ok: boolean;
  headers: Headers;
  payload: Json;
}

const TIMEOUT_MS = 30_000;

// An AxiError carrying extra top-level fields for the error record
// (`status`, `details`, `vetoes` from the server; `state`, `head`, `sha` from merge).
export class BitbucketError extends AxiError {
  constructor(
    message: string,
    code: string,
    help: string[],
    readonly extras: JsonObject,
  ) {
    super(message, code, help);
  }
}

export async function bitbucketRequest(
  host: string,
  path: string,
  options: RequestOptions = {},
): Promise<Json> {
  const token = loadToken(host);
  if (!token) {
    throw new AxiError(`No Bitbucket access token is configured for ${host}`, "NOT_CONFIGURED", [
      `Run \`bitbucket-dc-axi config set --host ${host}\` in a terminal`,
    ]);
  }

  const url = new URL(`https://${host}/rest/${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const method = options.method ?? "GET";
  const reply = await send(url, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(method === "GET"
        ? {}
        : { "Content-Type": "application/json", "X-Atlassian-Token": "no-check" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }, host, token);
  if (!reply.ok) throw apiError(reply, token, host, options.help);
  return reply.payload;
}

// Checks a token before it is stored; Bitbucket names the token's user in X-AUSERNAME.
export async function validateToken(
  host: string,
  token: string,
): Promise<{ user: string; version: string }> {
  const reply = await send(new URL(`https://${host}/rest/api/1.0/application-properties`), {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  }, host, token);
  const retry = ["Create a personal HTTP access token with REPO_READ (REPO_WRITE to merge) and enter it again"];
  if (!reply.ok) {
    throw apiError(reply, token, host, {
      auth: retry,
      notFound: [`Check that \`--host ${host}\` is the address of the Bitbucket Data Center server`],
    });
  }
  const user = decodeUser(reply.headers.get("X-AUSERNAME")?.trim());
  if (!user) {
    throw new BitbucketError("Bitbucket did not accept the access token", "AUTH_ERROR", retry, { status: reply.status });
  }
  const version = isObject(reply.payload) && typeof reply.payload["version"] === "string"
    ? reply.payload["version"]
    : "unknown";
  return { user, version };
}

// Bitbucket percent-encodes X-AUSERNAME (`jdoe%40example.com`); a value that does not decode is kept as sent.
function decodeUser(value: string | undefined): string | undefined {
  try {
    return value && decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Replace the token first so truncation can never leave part of it behind.
export function redact(message: string, token: string): string {
  const masked = token ? message.replaceAll(token, "[redacted]") : message;
  return masked.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function send(url: URL, init: RequestInit, host: string, token: string): Promise<ServerReply> {
  try {
    const response = await globalThis.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = parseResponse(await response.text());
    return { status: response.status, ok: response.ok, headers: response.headers, payload };
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new AxiError(`Bitbucket at ${host} did not respond within 30 s`, "NETWORK_ERROR", [
        "Check network access to the server and retry",
      ]);
    }
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const code = (cause as { code?: unknown } | null)?.code;
    const reason = redact(`${typeof code === "string" ? `${code}: ` : ""}${cause instanceof Error ? cause.message : String(cause)}`, token);
    const proxied = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"].some((name) => process.env[name]);
    throw new AxiError(`Could not reach Bitbucket at ${host}: ${reason}`, "NETWORK_ERROR", [
      "Check network access, DNS, and TLS for the server and retry",
      ...(proxied && process.env["NODE_USE_ENV_PROXY"] !== "1"
        ? ["A proxy variable is set but Node's fetch ignores it: rerun with NODE_USE_ENV_PROXY=1 (Node 24.0+ or 22.21+)"]
        : []),
    ]);
  }
}

function parseResponse(text: string): Json {
  if (!text) return null;
  try {
    return JSON.parse(text) as Json;
  } catch {
    return text;
  }
}

function apiError(reply: ServerReply, token: string, host: string, help: ErrorHelp = {}): BitbucketError {
  const { status, payload } = reply;
  const errors = isObject(payload) && Array.isArray(payload["errors"])
    ? payload["errors"].filter(isObject)
    : [];
  const details = errors
    .flatMap((error) => [error["message"], ...(Array.isArray(error["details"]) ? error["details"] : [])])
    .filter((item): item is string => typeof item === "string" && item !== "")
    .map((item) => redact(item, token));
  const vetoes: JsonObject[] = errors
    .flatMap((error) => (Array.isArray(error["vetoes"]) ? error["vetoes"].filter(isObject) : []))
    .map((veto) => ({
      summary: redact(typeof veto["summaryMessage"] === "string" ? veto["summaryMessage"] : "", token),
      detail: redact(typeof veto["detailedMessage"] === "string" ? veto["detailedMessage"] : "", token),
    }));
  const extras: JsonObject = {
    status,
    ...(details.length ? { details } : {}),
    ...(vetoes.length ? { vetoes } : {}),
  };

  if (status === 401) {
    return new BitbucketError("Bitbucket rejected the request as unauthorized (401)", "AUTH_ERROR", help.auth ?? [
      "Reading and merge checks need REPO_READ; merging needs REPO_WRITE",
      `Run \`bitbucket-dc-axi config set --host ${host}\` to replace the token`,
    ], extras);
  }
  if (status === 403) {
    return new BitbucketError("Bitbucket denied this operation (403)", "PERMISSION_ERROR", [
      "Reading and merge checks need REPO_READ; merging needs REPO_WRITE",
    ], extras);
  }
  if (status === 404) {
    return new BitbucketError("Bitbucket resource not found (404)", "NOT_FOUND", help.notFound ?? [
      "Check the repository selector and the pull request number",
    ], extras);
  }
  if (status >= 500) {
    return new BitbucketError(`Bitbucket server error (${status})`, "SERVER_ERROR", [
      "Retry later",
    ], extras);
  }
  return new BitbucketError(`Bitbucket API request failed (${status})`, "API_ERROR", [
    "See `details` for the server's reason",
  ], extras);
}
