# AGENTS.md — working on the Unicali codebase

Guidance for coding agents (Claude Code, Codex, …) **changing this repository**.
To *use* Unicali to make videos, see the skill in `.claude/skills/unicali-mockups/` and
`docs/agents.md` instead.

## Commands

```bash
npm run dev          # editor only (local/IndexedDB mode), proxies /api to :5299 if a server runs
npm run serve:dev    # editor + API + live sync on :5299 with HMR (use this for agent features)
npm test             # Vitest: core + commands (fast, run after every core change)
npm run test:e2e     # Playwright in real Chrome: export, MCP, live sync (slower)
npm run typecheck    # tsc -b over app, server and scripts
npm run docs         # regenerate docs/reference/* and the skill's references from code
```

## Architecture rules (keep these true)

1. **`src/core` is pure TypeScript.** No DOM, no three.js, no Node APIs, relative imports only.
   It runs in the browser, in Node (server/MCP/CLI) and in tests.
2. **Every write goes through a command** (`src/core/commands`). UI, MCP, CLI and HTTP must not
   grow their own mutation logic. Add a command and every client gets it — the MCP server
   registers one tool per command automatically.
3. **`evaluate(project, t)` is pure and deterministic.** Preview and export both call it. Never
   read wall-clock time or randomness inside core.
4. **The engine knows nothing about time or presets.** It draws a `ResolvedScene`.
5. **The project JSON is a contract.** Changing its shape means bumping `PROJECT_VERSION` and
   adding a migration in `src/core/schema/project.ts`.
6. **The server binds to 127.0.0.1 only.** It reads and writes local files.

## Adding things

| Want to add | Touch | Then |
|---|---|---|
| A motion preset | `src/core/presets/*.ts` + `registry.ts` | `npm test`, `npm run docs` |
| A command | `src/core/commands/*.ts` + `COMMANDS` in `index.ts` | unit test in `commands.test.ts`, `npm run docs` |
| A template | `TEMPLATES` in `src/core/commands/templates.ts` | covered by the template test |
| A device | `src/core/devices/registry.ts` (+ a builder in `src/engine/devices/` for new shapes) | |
| An HTTP route | `server/http.ts`, client method in `server/client.ts` | |
| An MCP tool that is not a command | `server/mcp.ts` (uses the client only) | extend `e2e/mcp.spec.ts` |

Details and examples: `docs/extending.md`.

## Conventions

- TypeScript strict, no `any` in core. Zod schemas are the source of truth for argument types.
- Command descriptions are written **for agents**: say units, ranges and gotchas.
- Error messages name the bad argument and list valid options.
- Comments explain *why*, not *what*. Match the surrounding density.
- After changing commands/presets, run `npm run docs` so the generated references stay current.
