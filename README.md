# bitbucket-axi

Agent-facing Bitbucket Cloud CLI with compact [TOON](https://toonformat.dev/) output, strict validation, explicit empty states, and useful next-command hints.

## Install

Requires Node.js 20 or newer.

```sh
npm install -g bitbucket-axi
# From a checkout:
npm install -g .
```

## Authenticate

Create a Bitbucket Cloud API token with the repository, pull request, and pipeline scopes needed for your commands, then set both variables:

```sh
export ATLASSIAN_EMAIL="you@example.com"
export BITBUCKET_API_TOKEN="your-api-token"
```

The CLI is non-interactive. Credentials are used only for HTTP Basic authentication to `https://api.bitbucket.org/2.0/` and are never printed.

## Select a repository

Pass `-R/--repo <workspace/repo>` after the command:

```sh
bitbucket-axi pr list -R acme/widgets
```

When omitted, `bitbucket-axi` scans git remotes for a `bitbucket.org` repository. Running with no arguments shows a compact dashboard for the selected repository.

## Commands

| Command | Purpose |
| --- | --- |
| `repo view` | Show repository details |
| `pr list` | List pull requests |
| `pr view <id>` | Show one pull request; use `--full` for complete text |
| `pr create` | Create a pull request |
| `pipeline list` | List pipeline runs |
| `pipeline view <uuid>` | Show one pipeline run |
| `pipeline run` | Trigger a branch or custom pipeline |
| `api [method] <path>` | Call any Bitbucket Cloud REST API v2.0 path |

Run `bitbucket-axi --help` or `bitbucket-axi <command> --help` for the complete, concise flag reference.

## Examples

```sh
bitbucket-axi repo view
bitbucket-axi pr list --state open --fields source,destination
bitbucket-axi pr view 42 --full
bitbucket-axi pr create --title "Fix auth" --source fix/auth --destination main --body "Resolves token refresh"
bitbucket-axi pipeline list --fields commit,url
bitbucket-axi pipeline run --branch main
bitbucket-axi pipeline run --branch main --custom "Deploy production"
bitbucket-axi api /repositories/{workspace}/{repo}/refs/branches
bitbucket-axi api POST /repositories/{workspace}/{repo}/pipelines --field 'target={"type":"pipeline_ref_target","ref_type":"branch","ref_name":"main"}'
```

List commands default to compact fields. Add supported columns with `--fields`. Long descriptions and raw API string values are truncated by default; pass `--full` when complete content is needed.

## Development

```sh
npm install
npm run check
npm run dev -- --help
```

Tests mock HTTP responses and require no live Bitbucket credentials.
