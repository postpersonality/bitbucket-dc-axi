# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Run `npm run check` for the full TypeScript build and mocked-HTTP test suite.
- The public command surface and help live in `src/cli.ts` and `src/commands.ts`; keep this first release deliberately limited to repository view, pull requests, pipelines, and raw API access.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
