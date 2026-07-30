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

`bitbucket-axi` stores your Bitbucket Cloud API token in your operating system credential manager (macOS Keychain, Windows Credential Manager, or libsecret on Linux). It never writes the token to a plaintext file and never accepts it as a command-line argument.

Create a [Bitbucket Cloud API token](https://support.atlassian.com/bitbucket-cloud/docs/api-tokens/) with the `read:user:bitbucket` scope (used once by `config set` to verify the token belongs to your account) plus the repository, pull request, and pipeline scopes your commands need. Then store it:

```sh
printf '%s' "your-api-token" | bitbucket-axi config set --email you@example.com --token-stdin
```

Use the **Atlassian account email** that owns the token (not your Bitbucket username). The token is read from stdin, validated against Bitbucket's current-user endpoint, and only then written to the keychain. Verify setup at any time:

```sh
bitbucket-axi config status   # shows the configured email and readiness, never the token
bitbucket-axi config clear    # removes the stored credential (idempotent)
```

Every network-backed command requires a stored credential. If none is configured, the command makes no API call and returns an auth-required result pointing at `bitbucket-axi config set --email <email> --token-stdin`.

## Select a repository

Pass `-R/--repo <workspace/repo>` after the command:

```sh
bitbucket-axi pr list -R acme/widgets
```

When omitted, `bitbucket-axi` scans git remotes for a `bitbucket.org` repository. Running with no arguments shows a compact dashboard for the selected repository.

## Commands

| Command | Purpose |
| --- | --- |
| `config set --email <email> --token-stdin` | Validate and store API credentials in the OS keychain |
| `config status` | Show the configured email and credential readiness |
| `config clear` | Remove the stored credential |
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
pnpm install
pnpm run check
pnpm run dev -- --help
```

Tests mock HTTP responses and the OS credential store; they require no live Bitbucket credentials and never touch the real keychain.
