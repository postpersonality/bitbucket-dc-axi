import { loadGitCredentials } from "../credentials.js";

export const CREDENTIAL_HELPER_HELP = `usage: bitbucket-axi credential-helper <operation>
description: Git credential helper that supplies stored Bitbucket Cloud HTTPS credentials.
setup:
  git config --global credential.helper 'bitbucket-axi credential-helper'
operations[3]:
  get (used by git), store (ignored), erase (ignored)
notes:
  Default Git transport remains SSH; this is opt-in for HTTPS clones.
  Only responds to bitbucket.org requests. Configure with \`config git set --token-stdin\`.
`;

const BITBUCKET_HOST = "bitbucket.org";

// Git credential-helper protocol implementation. Git invokes this command as
// `bitbucket-axi credential-helper get|store|erase` and sends key=value request
// attributes on stdin. For `get`, we emit `username=<email>` and
// `password=<token>` when a Git token is configured and the request targets
// bitbucket.org; `store`/`erase` are no-ops because credentials are managed via
// `config git set`. Returning a plain string bypasses TOON encoding so git
// receives the raw protocol text it expects.
export async function credentialHelperCommand(
  args: string[],
  input: NodeJS.ReadableStream = process.stdin,
): Promise<string> {
  const operation = args[0];
  if (operation !== "get") return "";
  const attributes = await readAttributes(input);
  if (!isBitbucketRequest(attributes)) return "";
  const creds = loadGitCredentials();
  if (!creds) return "";
  return `username=${creds.email}\npassword=${creds.token}`;
}

async function readAttributes(input: NodeJS.ReadableStream): Promise<Record<string, string>> {
  const text = await readAll(input);
  const attributes: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const entry = line.replace(/\r$/, "");
    if (entry === "") break; // blank line terminates the attribute list
    const equals = entry.indexOf("=");
    if (equals > 0) attributes[entry.slice(0, equals)] = entry.slice(equals + 1);
  }
  return attributes;
}

async function readAll(input: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isBitbucketRequest(attributes: Record<string, string>): boolean {
  const host = (attributes["host"] ?? hostFromUrl(attributes["url"])).toLowerCase();
  return host === BITBUCKET_HOST;
}

function hostFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
