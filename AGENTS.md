# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Run `pnpm run check` for the full TypeScript build and mocked-HTTP test suite. This project uses pnpm; `pnpm-lock.yaml` is the source of truth (no `package-lock.json`). Regenerate `skills/bitbucket-dc-axi/SKILL.md` with `pnpm run build:skill` after changing `DESCRIPTION` or `src/skill.ts`.
- The CLI targets Bitbucket Data Center only (`https://<host>/rest/...`, `Authorization: Bearer <token>`). Shell, help, and error formatting live in `src/cli.ts`; HTTP and error mapping in `src/client.ts`; repository/PR-URL resolution in `src/context.ts`; commands in `src/commands/` (barrel `index.ts`, shared helpers `utils.ts`). Keep the surface limited to `home`, `pr list|view|create|merge-check|merge`, `builds`, and `config set|status|clear`.
- Exit codes and `code` values are a contract read by firstmate (`EXIT_CODES` in `src/cli.ts`); changing them or the `--json` fields of `pr view`, `pr merge-check`, `pr merge`, `pr create` is a major version bump. Errors go to stdout; nothing is written to stderr.
- The access token is stored only in the OS credential manager by `src/credentials.ts` (`@napi-rs/keyring`, service `bitbucket-dc-axi`, account = lowercased host, Secret Service on Linux with no keyutils fallback). There is no environment-variable or file fallback. Tests mock `fetch` and `@napi-rs/keyring` (or the `credentials` module); they never touch the real keychain or make live calls. Use `bitbucket.example.com` in tests and examples.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
