# Unicali Mockups

Animated 3D device mockups for app promo videos — in the browser, and fully drivable by AI agents.

Drop a screenshot or screen recording onto a 3D phone, tell the story as **shots** (hero, focus
on a feature, angle, orbit), add a **song** and fit the story to its bars and sections, pick a
**look**, preview in real time, and export MP4 (with music) / WebM with alpha / PNG sequences. Everything a human can do in the editor, an agent can
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

1. **Media**: drop a screenshot or screen recording. Cards and buttons are detected automatically.
2. **Music**: drop a song on the *Music* lane. Tempo, bars and sections (intro, build, peak) are
   detected and drawn as a beat grid across the timeline.
3. **Shots**: press **Create camera story** (angle → focus on each detected block → hero), or add
   shots one by one. Click a shot card to choose what it frames (drag on the screen miniature),
   its angle, its motion and how the camera arrives. Drag a card's edge to retime it; edges
   snap to bars (hold Alt to place freely).
4. **Fit to music**: shot changes land on bars and section changes, the length ends on a phrase.
   Optional **accents** add tiny pushes on the downbeats of energetic sections.
5. **Look**: one-click moods in *Scene*, including **Match media** (from your screenshot's colours).
6. **Motions** (entrances, floating, spins) and **keyframes** remain available for full control;
   **Key camera here** builds free camera paths, and shots can be baked to keyframes.
7. **Export**: MP4 (H.264 + AAC with the song), WebM (alpha) or PNG sequence; up to 2×, motion blur.

Shortcuts: Space play/pause · ←/→ frame step (Shift = 1 s) · Home/End · Ctrl+Z / Ctrl+Shift+Z · Delete removes a clip.

## For agents

- **Claude Code in this repo**: the `unicali` MCP server is configured in `.mcp.json` and the
  `unicali-mockups` skill in `.claude/skills/` teaches the workflow. Just ask:
  *"make a reel from ~/Desktop/home.png and ~/Music/track.mp3: open on the app, show the balance,
  then the transfer button, end on the phone, on the beat"*.
- **Any MCP client**: `node bin/unicali.mjs mcp-config` prints the config to paste.
- **Scripts / CI**: `node bin/unicali.mjs help`.

Agents get a `render_frames` tool that returns rendered frames as an image, so they can check
their work visually before exporting. Full guide: [docs/agents.md](docs/agents.md).

## Documentation

| Doc | What's inside |
|---|---|
| [docs/product/direction.md](docs/product/direction.md) | Research on Rotato, Screen Studio, Shots, Jitter…, the "shots on a musical grid" thesis |
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
src/core      pure TS: schema, animation, presets, shots, music analysis/sync, UI-region detection,
              camera math, commands (shared by all clients)
src/engine    three.js renderer (devices, screen shader, lighting)
src/export    offline WebCodecs exporter
src/ui        React editor
src/render    headless render page (driven by the server)
server/       workspace, HTTP + WebSocket, headless renderer, MCP server, CLI
.claude/skills/unicali-mockups   agent skill (workflow + camera direction + recipes)
docs/         documentation (reference/ is generated)
e2e/          Playwright tests
```
