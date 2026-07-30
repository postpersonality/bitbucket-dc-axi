# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Run `pnpm run check` for the full TypeScript build and mocked-HTTP test suite. This project uses pnpm; `pnpm-lock.yaml` is the source of truth (no `package-lock.json`).
- The public command surface and help live in `src/cli.ts` and the per-domain modules under `src/commands/` (barrel at `src/commands/index.ts`, shared helpers in `src/commands/utils.ts`); keep this release deliberately limited to repository view, pull requests, pipelines, raw API access, `config` credential management, and the opt-in `credential-helper` Git HTTPS helper.
- Bitbucket Cloud API credentials (Atlassian account email + API token, HTTP Basic `email:token`) are stored in the OS credential manager by `src/credentials.ts` via `@napi-rs/keyring`. `src/client.ts` loads them at the API boundary before every request; there is no environment-variable or plaintext fallback for API operations. Interactive `config set` securely prompts for missing API credentials; `--email <email> --token-stdin` remains the non-interactive path. Both validate against `/user/emails` before storing. A separate Git HTTP token for the optional `credential-helper` is stored in its own keychain entry (`bitbucket-cloud-git`) via `config git set --token-stdin`, reusing the API account email as the git username; default Git transport stays SSH. Tests mock `@napi-rs/keyring` (or the `credentials` module) and `fetch`; they never touch the real keychain or make live calls.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
