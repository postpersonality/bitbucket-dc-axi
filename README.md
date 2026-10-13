# bitbucket-dc-axi

Agent-facing Bitbucket Data Center CLI with compact [TOON](https://toonformat.dev/) output: read pull requests, check whether they can be merged, and merge them only at a verified head commit.

## Install

Requires Node.js 20 or newer.

```sh
npm install -g bitbucket-dc-axi
```

Install the agent skill:

```sh
npx skills add postpersonality/bitbucket-dc-axi --skill bitbucket-dc-axi -g
```

## Authenticate

`bitbucket-dc-axi` uses a Bitbucket Data Center HTTP access token, stored per host in the operating system credential manager. It never reads the token from environment variables or files and never accepts it as a command-line argument.

Create a personal HTTP access token in Bitbucket (**Manage account → HTTP access tokens**). Every command that calls the server needs `REPO_READ`; `pr merge` also needs `REPO_WRITE`. Then store it for the host:

```sh
bitbucket-dc-axi config set --host bitbucket.example.com
```

The token is prompted for without echo, validated against `GET /rest/api/1.0/application-properties` (the server must answer with an `X-AUSERNAME` header), and only then saved. The command prints the user name and the server version. For automation, pipe the token in:

```sh
token-producing-command | bitbucket-dc-axi config set --host bitbucket.example.com --token-stdin
bitbucket-dc-axi config status --host bitbucket.example.com   # never prints the token
bitbucket-dc-axi config clear --host bitbucket.example.com    # idempotent
```

On Linux the token is kept in Secret Service (GNOME Keyring or KWallet), which must be running and unlocked. Without it the CLI answers `CREDENTIAL_STORE_ERROR` rather than falling back to the kernel keyring, which does not survive a reboot.

## Select a repository

The repository is taken from the first available source:

1. a pull request URL `https://<host>/projects/<KEY>/repos/<slug>/pull-requests/<N>` (for `pr view`, `pr merge-check`, `pr merge`);
2. `-R/--repo <host>/<KEY>/<slug>` after the command (not together with a URL);
3. the `origin` remote: `ssh://git@<host>[:<port>]/<key>/<slug>.git`, `git@<host>:<key>/<slug>.git`, or `https://[<user>@]<host>[:<port>]/scm/<key>/<slug>.git`.

## Commands

| Command | Purpose |
| --- | --- |
| `home` (no arguments) | Open pull requests of the current repository |
| `pr list [--state open\|merged\|declined\|all] [--limit 1-100] [--fields ...]` | List pull requests |
| `pr view <id\|url> [--full]` | One pull request with a build summary on its head commit |
| `pr create --title --source [--destination] [--body]` | Create a pull request; the default destination is the repository default branch |
| `pr merge-check <id\|url>` | Read-only: every unmet merge condition in `blockers` |
| `pr merge <id\|url> --sha <commit>` | Merge only if the head is still the given full commit |
| `builds <commit>` | All build statuses of a full commit |
| `config set\|status\|clear --host <host>` | Manage the stored access token |

Add `--json` to any command for the same record in JSON. Run `bitbucket-dc-axi --help` or `bitbucket-dc-axi <command> --help` for the full flag reference.

```sh
bitbucket-dc-axi pr view https://bitbucket.example.com/projects/PROJ/repos/repo/pull-requests/7 --json
bitbucket-dc-axi pr merge-check 7 -R bitbucket.example.com/PROJ/repo
bitbucket-dc-axi pr merge 7 --sha 0123456789abcdef0123456789abcdef01234567 --json
```

## Errors and exit codes

Errors are printed to stdout as the same kind of record as a result (`error`, `code`, `help`; server errors add `status` and `details`). Nothing is written to stderr.

| Exit | `code` |
| --- | --- |
| 0 | success, including repeats without changes (`already_merged`, `already clear`) and `merge-check` with blockers |
| 1 | `NOT_FOUND`, `MERGE_REJECTED`, `HEAD_MOVED`, `MERGED_DIFFERENT_HEAD`, `NOT_OPEN`, `API_ERROR`, `INTERNAL_ERROR` |
| 2 | `VALIDATION_ERROR` |
| 3 | `NOT_CONFIGURED`, `CREDENTIAL_STORE_ERROR`, `REPO_NOT_RESOLVED` |
| 4 | `AUTH_ERROR`, `PERMISSION_ERROR` |
| 5 | `NETWORK_ERROR`, `SERVER_ERROR` |

## Development

```sh
pnpm install
pnpm run check
pnpm run dev -- --help
```

The skill at `skills/bitbucket-dc-axi/SKILL.md` is generated from the CLI description; regenerate it with `pnpm run build:skill` and verify it with `pnpm run build:skill -- --check`. Tests mock HTTP and the credential store; they make no live calls and never touch the real keychain.

## Acknowledgements

Forked from [bitbucket-axi](https://github.com/kitwon/bitbucket-axi) by Kit Chan, the Bitbucket Cloud CLI this one is rewritten from.
