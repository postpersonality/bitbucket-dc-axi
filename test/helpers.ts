import { execFileSync } from "node:child_process";
import { vi, type Mock } from "vitest";
import { main } from "../src/cli.js";
import type { Json, JsonObject } from "../src/client.js";
import { loadToken } from "../src/credentials.js";

// Programs the mocks only: every test file using these helpers declares
// vi.mock("../src/credentials.js") and vi.mock("node:child_process") itself.

export const HOST = "bitbucket.example.com";
export const TOKEN = "secret-token-123";
export const HEAD = "a".repeat(40);
export const OTHER = "b".repeat(40);
export const REPO = "bitbucket.example.com/PROJ/repo";
export const PR_URL = "https://bitbucket.example.com/projects/PROJ/repos/repo/pull-requests/7";

export type FetchMock = Mock<typeof fetch>;

export function response(status: number, body?: Json, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const REPOSITORY: JsonObject = {
  slug: "repo",
  name: "repo",
  project: { key: "PROJ", name: "Project" },
};

// RestPullRequest as swagger 10.0 describes it, plus the links.self servers send.
export function pullRequest(overrides: JsonObject = {}): JsonObject {
  return {
    id: 7,
    version: 3,
    title: "Add feature",
    description: "Implements the feature",
    state: "OPEN",
    open: true,
    closed: false,
    draft: false,
    locked: false,
    createdDate: Date.UTC(2026, 9, 12, 8, 30),
    updatedDate: Date.UTC(2026, 9, 12, 9, 0),
    fromRef: { id: "refs/heads/feature", displayId: "feature", latestCommit: HEAD, repository: REPOSITORY },
    toRef: { id: "refs/heads/main", displayId: "main", latestCommit: OTHER, repository: REPOSITORY },
    author: {
      user: { name: "jdoe", displayName: "Jane Doe", emailAddress: "jdoe@example.com" },
      role: "AUTHOR",
      approved: false,
      status: "UNAPPROVED",
    },
    reviewers: [],
    participants: [],
    links: { self: [{ href: PR_URL }] },
    ...overrides,
  };
}

export function page(values: Json[], options: { isLastPage?: boolean; nextPageStart?: number } = {}): JsonObject {
  return {
    size: values.length,
    limit: 25,
    start: 0,
    isLastPage: options.isLastPage ?? true,
    ...(options.nextPageStart === undefined ? {} : { nextPageStart: options.nextPageStart }),
    values,
  };
}

export function stats(counts: Partial<Record<"successful" | "failed" | "inProgress" | "cancelled" | "unknown", number>> = {}): JsonObject {
  return { successful: 0, failed: 0, inProgress: 0, cancelled: 0, unknown: 0, ...counts };
}

type Route = Response | ((url: URL, init?: RequestInit) => Response);

// Answers by "METHOD /pathname"; anything else is a 404 so missing routes fail loudly.
export function routes(fetchMock: FetchMock, table: Record<string, Route>): void {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const route = table[`${init?.method ?? "GET"} ${url.pathname}`];
    if (!route) return response(404, { errors: [{ message: `no route for ${url.pathname}` }] });
    return typeof route === "function" ? route(url, init) : route.clone();
  });
}

export function calls(fetchMock: FetchMock): { method: string; path: string; query: Record<string, string>; body: Json | undefined; headers: Record<string, string> }[] {
  return fetchMock.mock.calls.map(([input, init]) => {
    const url = new URL(String(input));
    return {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Json) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
  });
}

export function setOrigin(url?: string): void {
  vi.mocked(execFileSync).mockImplementation(() => {
    if (url === undefined) throw new Error("fatal: not a git repository");
    return `${url}\n`;
  });
}

export function fakeServer(): FetchMock {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(loadToken).mockReturnValue(TOKEN);
  return fetchMock;
}

export async function run(argv: string[]): Promise<{ out: string; code: number }> {
  let out = "";
  process.exitCode = undefined;
  try {
    await main({ argv, stdout: { write: (chunk: string) => (out += chunk) } });
    return { out, code: Number(process.exitCode ?? 0) };
  } finally {
    process.exitCode = undefined;
  }
}
