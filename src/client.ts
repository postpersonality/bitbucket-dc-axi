import { AxiError } from "axi-sdk-js";

export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}

interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: JsonObject;
}

const API_ROOT = "https://api.bitbucket.org/2.0/";

export async function bitbucketRequest(
  path: string,
  options: RequestOptions = {},
): Promise<Json> {
  const email = process.env["ATLASSIAN_EMAIL"];
  const token = process.env["BITBUCKET_API_TOKEN"];
  if (!email || !token) {
    throw new AxiError(
      "Bitbucket authentication is not configured",
      "AUTH_ERROR",
      ["Set ATLASSIAN_EMAIL and BITBUCKET_API_TOKEN, then retry"],
    );
  }

  const normalized = normalizePath(path);
  const url = new URL(normalized, API_ROOT);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await globalThis.fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new AxiError("Could not reach Bitbucket Cloud", "NETWORK_ERROR", [
      "Check network access to api.bitbucket.org and retry",
    ]);
  }

  const text = await response.text();
  const payload = parseResponse(text);
  if (!response.ok) throw apiError(response.status, payload);
  return payload;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes("://")) {
    throw new AxiError("API path must be relative to Bitbucket Cloud API v2.0", "VALIDATION_ERROR", [
      "Use a path such as `/repositories/{workspace}/{repo}`",
    ]);
  }
  return trimmed.replace(/^\/+/, "").replace(/^2\.0\//, "");
}

function parseResponse(text: string): Json {
  if (!text) return null;
  try {
    return JSON.parse(text) as Json;
  } catch {
    return text;
  }
}

function apiError(status: number, payload: Json): AxiError {
  if (status === 401) {
    return new AxiError("Bitbucket authentication failed", "AUTH_ERROR", [
      "Check ATLASSIAN_EMAIL and BITBUCKET_API_TOKEN and their token expiry",
    ]);
  }
  if (status === 403) {
    return new AxiError("Bitbucket denied this operation", "PERMISSION_ERROR", [
      "Grant the API token the repository, pull request, or pipeline scope this command needs",
    ]);
  }
  if (status === 404) {
    return new AxiError("Bitbucket resource not found", "NOT_FOUND", [
      "Check the repository selector and resource identifier",
    ]);
  }

  const rawDetail =
    isObject(payload) && isObject(payload["error"]) && typeof payload["error"]["message"] === "string"
      ? payload["error"]["message"]
      : "";
  const detail = redact(rawDetail);
  return new AxiError(
    `Bitbucket API request failed (${status})${detail ? `: ${detail}` : ""}`,
    "API_ERROR",
  );
}

function redact(message: string): string {
  let result = message.replace(/[\r\n\t]+/g, " ").slice(0, 300);
  for (const secret of [process.env["ATLASSIAN_EMAIL"], process.env["BITBUCKET_API_TOKEN"]]) {
    if (secret) result = result.replaceAll(secret, "[redacted]");
  }
  return result;
}

export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
