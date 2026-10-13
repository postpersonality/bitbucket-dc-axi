---
name: bitbucket-dc-axi
description: "Use the bitbucket-dc-axi CLI to list, view, create, check, and merge Bitbucket Data Center pull requests, read commit build statuses, or manage per-host access tokens. Use whenever a task involves pull requests or builds on a self-hosted Bitbucket Data Center or Server instance."
user-invocable: false
author: Nikolay Seliverstov
metadata:
  hermes:
    tags: [bitbucket, bitbucket-data-center, pull-requests, builds]
    category: developer-tools
---

# bitbucket-dc-axi

Read, check, and merge Bitbucket Data Center pull requests by verified commit with agent-efficient output.

## When to use

Use bitbucket-dc-axi whenever a task needs pull requests on a Bitbucket Data Center instance: listing or reading them, creating one, checking whether one can be merged, merging it only at a verified head commit, or reading the build statuses of a commit. A clean merge-check does not show that the stored token may merge; pr merge can still fail with AUTH_ERROR.

Get every command, flag, and workflow from the live CLI - it is the single source of truth:

- `npx -y bitbucket-dc-axi` - open pull requests of the current repository
- `npx -y bitbucket-dc-axi --help` - global usage
- `npx -y bitbucket-dc-axi <command> --help` - per-command usage

Access tokens are stored per host in the OS credential manager. If the CLI reports that a host is not configured, run `npx -y bitbucket-dc-axi config set --host <host>`; for automation, pipe the token to `npx -y bitbucket-dc-axi config set --host <host> --token-stdin`.
