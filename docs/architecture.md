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
| Core | `src/core` | Document model, animation math, presets, shots, music analysis/sync, region detection, commands | nothing outside core |
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
2. **shots** replace the camera's rest pose (the camera story; `src/core/shots`),
3. **absolute** preset curves (latest started clip wins),
4. keyframe **tracks** (override),
5. **offset** preset curves, summed — this is what lets motions stack,
6. musical **accents** (a relative push of the camera distance on energetic downbeats).

## Shots and music

- A **shot** is a framing intent (`hero`, `focus` on a screen region, `angle`, `wide`, `orbit`)
  plus an in-shot move and an arrival. Shots are contiguous; `start` is the *arrival* and the
  transition plays before it, so starts on bars make arrivals land on the beat. Framing uses
  `src/core/camera/framing.ts`, so a focus shot survives device, aspect and model changes.
- **Music analysis** (`src/core/music/analyze.ts`) runs on PCM in the browser (editor) or in
  headless Chrome (server imports): SuperFlux onsets with a low-band emphasis, tempo by
  autocorrelation with a 120 BPM prior, dynamic-programming beat tracking, 4/4 downbeats from
  low-frequency accents, and energy sections from 4-bar novelty. The result is **stored in the
  project** so it never re-runs silently and can be corrected (`set_tempo`).
- **Sync** (`src/core/music/sync.ts`): project-time grid, snapping (bars before beats),
  `fitToMusic` (bars per shot, phrase-length total, section snapping, entrances landing on
  downbeats) and energy-aware accents.
- **UI regions** (`src/core/vision/regions.ts`) segment a screenshot thumbnail into content
  blocks; stored on the asset with its palette and used by `create_storyboard` and looks.
- **Audio out**: the preview plays the song with Web Audio and uses the audio clock as master;
  the exporter renders an offline mix (song with fades + optional recording audio) and encodes
  it (AAC/Opus).

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

## Capture (material from running apps)

```
server/capture/
  types.ts        CaptureSource / CaptureSession / Recording — the only contract
  hub.ts          sessions; every still/take ends in Workspace.importMedia
  take.ts         source-agnostic take runner: relaunch → setup → rehearsal → record
  android/        ADB: UIAutomator semantics, screencap, screenrecord, SystemUI demo mode
  web/            Playwright at a phone viewport; CDP screencast frames
src/core/capture/ steps (zod), UI tree parsing + target resolution, motion trim — pure
```

- **Decoupled by design**: sources only produce files plus `Asset.source` metadata; the editor,
  renderer and exporter never know where pixels came from. Adding iOS or desktop means one new
  `CaptureSource`.
- **Takes are directed, not recorded**: the runner relaunches the app, runs setup off camera,
  rehearses the on-camera steps (resolving semantic targets to points and measuring how long each
  screen takes to settle), then records at rehearsed timing so no lookups appear as dead time.
- **Clean presentation**: Android demo mode (9:41, full battery/signal, no notifications); the
  device's original setting is persisted to disk and restored on close, shutdown or next session.
- **Analysis**: takes are analysed in the headless renderer — motion curve → `trim`, settled
  `moments`, `poster`; UI regions and palette come from the poster. Variable-frame-rate recordings
  end on their last change, which is treated as the settled result.
- **Encoding**: Android records device-side H.264; web frames are encoded by the renderer
  (WebCodecs + Mediabunny), so no external binaries are needed.
- **Per-shot media**: `Shot.media` (`assetId`, `from`, `speed`, `fitTake`) lets one story use many
  screens and takes; media time is resolved in core (`src/core/shots/media.ts`) and every screen
  asset is preloaded before rendering (`screenAssetIds`).

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
