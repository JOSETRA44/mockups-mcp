# Architecture

Unicali is one TypeScript codebase with three runtimes: the **browser editor**, the **Node
server** (HTTP + MCP + CLI), and **headless Chrome** for rendering. They share one core.

```
                       ┌──────────────── src/core (pure TS) ────────────────┐
                       │ schema · channels · evaluate(t) · presets · camera │
                       │ commands (the only write API) · queries · templates│
                       └───────▲──────────────────▲──────────────────▲──────┘
                               │                  │                  │
   Browser editor (src/ui) ────┘     Node server (server/)     Render page (src/render)
   zustand store → exec(cmd)         workspace · HTTP · WS     Engine + exporter in
   Engine (three.js) viewport        MCP · CLI · Renderer ───► headless Chrome
```

## Layers

| Layer | Path | Responsibility | May import |
|---|---|---|---|
| Core | `src/core` | Document model, animation math, presets, commands | nothing outside core |
| Engine | `src/engine` | three.js scene from a `ResolvedScene`; screen sources | core, three |
| Export | `src/export` | Offline frame loop → WebCodecs → Mediabunny | core, engine |
| Media | `src/media` | Import, IndexedDB, server backend | core |
| State | `src/state` | Editor store (undo), playback, sync | core, media |
| UI | `src/ui` | React components | everything above |
| Render entry | `src/render` | Headless page driven by the server | core, engine, export |
| Server | `server/` | Workspace, HTTP/WS, renderer, MCP, CLI | core (never UI/engine) |

## The document

`Project` (`src/core/schema/project.ts`) is versioned JSON: settings (size, fps, duration,
background, lighting), `nodes` (devices + camera), `assets`, `clips` (preset instances) and
`tracks` (keyframes). Every animatable property is a flat numeric **channel** addressed as
`<nodeId>.<channel>` (`camera.yaw`, `device-x.rotation.y`).

## Evaluation

`evaluate(project, t)` is pure:

1. base values from the document,
2. **absolute** preset curves (latest started clip wins),
3. keyframe **tracks** (override),
4. **offset** preset curves, summed — this is what lets motions stack.

Preset curves are built from `preset.build(params, ctx)` and cached per clip object (immutable
updates make the cache trivially correct).

## Commands

`src/core/commands` defines every write operation as `{ name, summary, description, args: Zod,
run(project, args, ctx) → { project, result } }`. Consumers:

- **Editor**: `useEditor.getState().exec(name, args)` (sliders, viewport gestures, templates)
- **Server**: `POST /api/projects/:id/commands` → `Workspace.exec` (saves, bumps revision, broadcasts)
- **MCP**: one tool per command, generated from the registry
- **CLI**: `unicali exec` / `unicali batch`

Arguments are validated strictly; errors are `CommandError` with a code and an agent-readable
message. `runBatch` applies several commands atomically.

## Persistence and collaboration

- **Standalone** (static hosting or `npm run dev` alone): projects and blobs in IndexedDB.
- **Connected** (page served by `unicali serve`): `src/media/backend.ts` switches to the HTTP
  backend. The editor opens `WS /api/live`, pushes its document (debounced), and applies
  snapshots from other origins (agents) without recording undo steps.
- The server's `Workspace` keeps one in-memory entry per project (document, revision, 50-step
  history), writes atomically (tmp + rename), and emits change events to WebSocket subscribers.
  Conflict policy: last writer wins; revisions let clients detect remote changes.

## Rendering

`Engine` draws a `ResolvedScene` — it never sees time or presets. The viewport calls it every
animation frame; the exporter (and the render page) create a separate `Engine` on an
`OffscreenCanvas` at output resolution. Screen content comes from `ScreenSource`s: a `<video>`
element for preview, frame-exact Mediabunny decoding for export. See [export.md](export.md).

## Scaling plan

- **More node types** (text, image, logo, 3D model): add to the `SceneNode` union, declare
  channels in `channels.ts`, render in the engine, add commands. Presets and keyframes work
  automatically through channels.
- **GLB devices**: a new `builder` on `DeviceSpec` that loads a model and names its screen mesh.
- **Server rendering at scale**: the render page already runs headless; queue jobs across
  several browser contexts or machines — the document is plain JSON.
- **Export in a worker**: move the export loop to a Web Worker with OffscreenCanvas (the engine
  already accepts an OffscreenCanvas).
- **Multi-user**: replace last-writer-wins with command-level sync (commands are already
  serialisable) or a CRDT on the document.
