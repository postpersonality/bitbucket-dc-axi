import { DESCRIPTION } from "./cli.js";

export const SKILL_DESCRIPTION =
  "Use the bitbucket-dc-axi CLI to list, view, create, check, and merge Bitbucket Data Center pull requests, read commit build statuses, or manage per-host access tokens. Use whenever a task involves pull requests or builds on a self-hosted Bitbucket Data Center or Server instance.";

export const SKILL_AUTHOR = "Nikolay Seliverstov";

const HERMES_TAGS = ["bitbucket", "bitbucket-data-center", "pull-requests", "builds"];
const HERMES_CATEGORY = "developer-tools";

function yamlDoubleQuote(value: string): string {
  return JSON.stringify(value);
}

export function createSkillMarkdown(): string {
  return `---
name: bitbucket-dc-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
metadata:
  hermes:
    tags: [${HERMES_TAGS.join(", ")}]
    category: ${HERMES_CATEGORY}
---

# bitbucket-dc-axi

${DESCRIPTION}

## When to use

Use bitbucket-dc-axi whenever a task needs pull requests on a Bitbucket Data Center instance: listing or reading them, creating one, checking whether one can be merged, merging it only at a verified head commit, or reading the build statuses of a commit.

Get every command, flag, and workflow from the live CLI - it is the single source of truth:

- \`npx -y bitbucket-dc-axi\` - open pull requests of the current repository
- \`npx -y bitbucket-dc-axi --help\` - global usage
- \`npx -y bitbucket-dc-axi <command> --help\` - per-command usage

Access tokens are stored per host in the OS credential manager. If the CLI reports that a host is not configured, run \`npx -y bitbucket-dc-axi config set --host <host>\`; for automation, pipe the token to \`npx -y bitbucket-dc-axi config set --host <host> --token-stdin\`.\n\nBehind an HTTP(S) proxy, run the CLI with \`NODE_USE_ENV_PROXY=1\` (Node 24.0+ or 22.21+) so Node's \`fetch\` honours \`HTTPS_PROXY\`/\`HTTP_PROXY\`; without it every request fails with \`NETWORK_ERROR\`.\n`;
}
