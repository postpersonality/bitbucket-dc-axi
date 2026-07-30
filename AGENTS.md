# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Run `pnpm run check` for the full TypeScript build and mocked-HTTP test suite. This project uses pnpm; `pnpm-lock.yaml` is the source of truth (no `package-lock.json`).
- The public command surface and help live in `src/cli.ts` and `src/commands.ts`; keep this release deliberately limited to repository view, pull requests, pipelines, raw API access, and `config` credential management.
- Bitbucket Cloud API credentials (Atlassian account email + API token, HTTP Basic `email:token`) are stored in the OS credential manager by `src/credentials.ts` via `@napi-rs/keyring`. `src/client.ts` loads them at the API boundary before every request; there is no environment-variable or plaintext fallback for API operations. `config set --email <email> --token-stdin` validates against `/user/emails` before storing. Tests mock `@napi-rs/keyring` (or the `credentials` module) and `fetch`; they never touch the real keychain or make live calls.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
