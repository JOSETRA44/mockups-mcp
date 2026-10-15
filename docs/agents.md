# Using Unicali from agents (MCP, CLI, HTTP)

Unicali is built so an AI agent has the same power as a human in the editor: create projects,
import local files, animate devices and cameras, **look at rendered frames**, and export videos.
A human can watch and edit the same project live in the browser while the agent works.

```
 Claude Code / Codex / Cursor ──MCP (stdio)──┐
 shell scripts, CI ─────────────CLI──────────┼──HTTP──►  unicali server (127.0.0.1:5299)
 the editor in a browser ───────WebSocket────┘            ├─ workspace on disk (~/UnicaliMockups)
                                                          ├─ core commands (same as the UI)
                                                          └─ headless Chrome renderer
```

## 1. Connect an agent (MCP)

**Claude Code, inside this repo:** nothing to do — `.mcp.json` registers the `unicali` server
(approve it the first time). The project skill `.claude/skills/unicali-mockups` teaches Claude
the workflow.

**Claude Code, anywhere:**
```bash
claude mcp add unicali -- node "<repo>/bin/unicali.mjs" mcp
```

**Other MCP clients (Claude Desktop, Cursor, Windsurf…):**
```json
{ "mcpServers": { "unicali": { "command": "node", "args": ["<repo>/bin/unicali.mjs", "mcp"] } } }
```

**Codex (`~/.codex/config.toml`):**
```toml
[mcp_servers.unicali]
command = "node"
args = ["<repo>/bin/unicali.mjs", "mcp"]
```

`node bin/unicali.mjs mcp-config` prints these snippets with your absolute path filled in.

The MCP process connects to a running server on port 5299 or starts one in-process. To keep
the editor open while agents work, run `npm run serve` yourself and open http://127.0.0.1:5299.

### Using the skill outside this repo

Copy `.claude/skills/unicali-mockups/` to `~/.claude/skills/` (personal) or another project's
`.claude/skills/`. The skill works with the MCP tools, or with the CLI when MCP is unavailable.

## 2. MCP tools

| Group | Tools |
|---|---|
| Session | `unicali_status`, `get_catalog`, `list_projects`, `create_project`, `use_project`, `get_project`, `delete_project` |
| Media | `import_media` (screenshot/recording → device screen with detected UI regions; song → music track with tempo/bars/sections) |
| Capture | `capture_targets`, `capture_open` (android / web), `capture_look`, `capture_act`, `capture_still`, `capture_take`, `capture_close`, `review_material` |
| Story | `set_shots`, `add_shot`, `update_shot`, `move_shot`, `remove_shot`, `create_storyboard`, `bake_shots` |
| Music | `fit_to_music`, `set_music` (start, volume, fades, accents), `set_tempo` (grid corrections), `remove_music` |
| Look | `apply_look` (incl. `match-media`), `set_background`, `set_lighting` |
| Editing | one tool per command — see [reference/commands.md](reference/commands.md) — plus `batch`, `undo`, `redo` |
| Seeing | `sample_motion` (numbers), `render_frames` (contact-sheet **image**; defaults to one frame per shot hold) |
| Output | `export_video` (mp4 / webm with alpha / png zip) |

Every tool takes an optional `projectId`; it defaults to the current project (set by
`create_project`/`use_project`, else the most recent). Errors are returned as tool errors whose
text names the bad argument and the valid options, so agents can self-correct. Unknown
arguments are rejected (no silent typos).

Resources: `unicali://catalog`. Prompts: `app-promo` (guided promo workflow).

### The brief-to-ad loop (no files needed)

```
create_project → capture_open(app) → capture_look/capture_act (explore)
→ capture_take per story beat (+ capture_still) → review_material → capture_close
→ import_media(song) → set_shots with per-shot media (fitTake) → fit_to_music
→ render_frames → adjust → export_video
```

See `.claude/skills/unicali-mockups/references/capture.md` for take direction.

### The script-to-video loop

```
create_project → import_media(screenshot) → import_media(song)
→ set_shots (one shot per script line) or create_storyboard → fit_to_music
→ render_frames (look at every shot) → update_shot / apply_look → export_video
```

## 3. CLI

```bash
node bin/unicali.mjs help                      # or: npm run unicali -- help
node bin/unicali.mjs new --name "Promo" --template feature-zoom
node bin/unicali.mjs import <id> ~/Desktop/home.png
node bin/unicali.mjs exec <id> set_background '{"kind":"gradient","color":"#0b1f3a","color2":"#2f6bff"}'
node bin/unicali.mjs batch <id> steps.json     # [{ "command": "...", "args": {...} }, ...]
node bin/unicali.mjs frames <id> --times 1,3,5 --out sheet.png
node bin/unicali.mjs export <id> --format mp4 --motion-blur 4 --out ~/Desktop/promo.mp4
```

Every CLI command auto-starts a server when none is running.

## 4. HTTP API

All JSON, loopback only. Errors: `{ "error": { "code", "message" } }` with 400/404/409/500.

| Method & path | Body → response |
|---|---|
| `GET /api/health` | → `{ ok, name: "unicali", version, home, url }` |
| `GET /api/catalog` | → presets, devices, templates, eases, formats, channels, `commands` (JSON Schemas) |
| `GET /api/projects` | → `{ projects: [{ id, name, updatedAt, revision, format, duration }] }` |
| `POST /api/projects` | `{ name?, template? }` → `{ project, revision }` |
| `GET /api/projects/:id` | → `{ project, revision }` (full document) |
| `PUT /api/projects/:id` | `{ project, origin? }` → `{ project, revision }` (replace; last writer wins) |
| `DELETE /api/projects/:id` | → `{ ok }` |
| `GET /api/projects/:id/describe` | → compact summary with clip ids |
| `POST /api/projects/:id/commands` | `{ command, args }` or `{ batch: [{ command, args }] }` → `{ revision, result, summary }` |
| `POST /api/projects/:id/undo` · `/redo` | → `{ revision, summary }` (server-side history, 50 steps) |
| `POST /api/projects/:id/sample` | `{ times: number[] }` → resolved camera/device poses |
| `POST /api/projects/:id/import` | `{ path, deviceId?, assign?, name? }` → `{ asset, revision }` |
| `PUT /api/projects/:id/assets?name=x.png[&register=1]` | raw bytes → `{ asset }` |
| `GET /api/assets/:assetId` | file bytes (supports `Range`) |
| `GET /api/capture/targets` | → `{ targets: [{ id, kind, name, state }] }` |
| `POST /api/capture/sessions` | `{ kind, target?, app?, install?, clean? }` → look `{ sessionId, elements, png, … }` |
| `GET /api/capture/sessions/:sid/look` | → look (screenshot base64 + elements) |
| `POST /api/capture/sessions/:sid/act` | `{ step, look? }` → look after the UI settles |
| `POST /api/capture/sessions/:sid/still` | `{ projectId, label }` → `{ asset }` |
| `POST /api/capture/sessions/:sid/take` | `{ projectId, take }` → `{ asset, performed }` |
| `POST /api/capture/sessions/:sid/record-start` · `record-stop` | manual recording (`{ projectId, label }` on stop) |
| `DELETE /api/capture/sessions/:sid` | restore the device and close |
| `POST /api/projects/:id/material` | `{ assetIds? }` → `image/png` review sheet |
| `POST /api/projects/:id/frames` | `{ times?, width?, columns?, labels?, outputPath? }` → `image/png` |
| `POST /api/projects/:id/export` | `{ format, scale, fps, quality, motionBlur, includeAudio, outputPath?, overwrite? }` → `{ path, codec, frames, seconds, bytes }` |
| `WS /api/live?project=:id&client=:cid` | server → `{type:"snapshot", project, revision, origin}`; client → `{type:"put", project}` |

## 5. Workspace layout

```
~/UnicaliMockups/                 (override with UNICALI_HOME)
  projects/<projectId>/
    project.json                  the document (versioned, human-readable)
    assets/<assetId>.<ext>        imported screenshots / recordings
    renders/                      default export location
```

`project.json` is plain JSON validated on load; editing it by hand is fine while the server is
stopped (a running server keeps its in-memory copy).

## 6. Environment

| Variable | Default | Purpose |
|---|---|---|
| `UNICALI_HOME` | `~/UnicaliMockups` | workspace folder |
| `UNICALI_PORT` | `5299` | server port (127.0.0.1 only) |
| `UNICALI_CHROME` | Chrome channel | Chrome/Chromium executable for headless rendering |
| `UNICALI_DEV` | `0` | `1` serves the editor through Vite (HMR) |
