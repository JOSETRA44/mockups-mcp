# Unicali Mockups

Animated 3D device mockups for app promo videos — in the browser, and fully drivable by AI agents.

Drop a screenshot or screen recording onto a 3D phone, stack motion presets (hero reveal,
orbit, push-in, screen focus…), design camera journeys, preview in real time, and export
MP4 / WebM with alpha / PNG sequences. Everything a human can do in the editor, an agent can
do through **MCP**, the **CLI** or the **HTTP API** — and both can work on the same project
live.

## Quick start

```bash
npm install
npm run serve          # editor + API + live sync → http://127.0.0.1:5299
```

Projects are saved to `~/UnicaliMockups` (change with `UNICALI_HOME`). Want just the editor
with browser storage? `npm run dev`.

Requires Node 20+ and Google Chrome (used for headless rendering and H.264 export).

## For humans

1. **Media** tab: drop a screenshot or screen recording.
2. **Motion** tab: start from a template or click presets to add them at the playhead.
   Motions stack; drag/resize clips on the timeline.
3. **Camera journeys**: select *Camera*, move the playhead, frame a shot (sliders, drag in the
   viewport, scroll to zoom) and press **Key camera here**. Repeat. Once a channel has
   keyframes, sliders edit the key at the playhead; the ◆ button toggles keys.
4. **Export**: MP4, WebM (alpha) or PNG sequence; resolution up to 2×, motion blur, audio.

Shortcuts: Space play/pause · ←/→ frame step (Shift = 1 s) · Home/End · Ctrl+Z / Ctrl+Shift+Z · Delete removes a clip.

## For agents

- **Claude Code in this repo**: the `unicali` MCP server is configured in `.mcp.json` and the
  `unicali-mockups` skill in `.claude/skills/` teaches the workflow. Just ask:
  *"make a 8-second reel from ~/Desktop/home.png that zooms into the balance card"*.
- **Any MCP client**: `node bin/unicali.mjs mcp-config` prints the config to paste.
- **Scripts / CI**: `node bin/unicali.mjs help`.

Agents get a `render_frames` tool that returns rendered frames as an image, so they can check
their work visually before exporting. Full guide: [docs/agents.md](docs/agents.md).

## Documentation

| Doc | What's inside |
|---|---|
| [docs/agents.md](docs/agents.md) | MCP setup, tools, CLI, HTTP API, workspace layout |
| [docs/architecture.md](docs/architecture.md) | Layers, document model, evaluation, sync, scaling plan |
| [docs/export.md](docs/export.md) | Why offline WebCodecs export, formats, colour, performance |
| [docs/extending.md](docs/extending.md) | Add presets, commands, templates, devices, node types |
| [docs/reference/commands.md](docs/reference/commands.md) | Every command and argument (generated) |
| [docs/reference/presets.md](docs/reference/presets.md) | Presets, templates, devices, channels (generated) |
| [AGENTS.md](AGENTS.md) | Rules for coding agents working on this repo |

## Development

```bash
npm run serve:dev    # server with Vite HMR
npm test             # unit tests (core + commands)
npm run test:e2e     # Playwright in real Chrome: export, MCP, live sync
npm run typecheck
npm run docs         # regenerate reference docs from code
```

## Project layout

```
src/core      pure TS: schema, animation, presets, camera math, commands (shared by all clients)
src/engine    three.js renderer (devices, screen shader, lighting)
src/export    offline WebCodecs exporter
src/ui        React editor
src/render    headless render page (driven by the server)
server/       workspace, HTTP + WebSocket, headless renderer, MCP server, CLI
.claude/skills/unicali-mockups   agent skill (workflow + camera direction + recipes)
docs/         documentation (reference/ is generated)
e2e/          Playwright tests
```
