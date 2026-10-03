# Unicali Mockups

A browser editor for animated 3D device mockups (app promo videos, reels, landing pages).
Drop a screenshot or screen recording onto a phone, stack motion presets, preview in real time,
and export MP4 / WebM (with alpha) / PNG sequences. It is local-first: no backend, and projects live in IndexedDB.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # core unit tests (Vitest)
npm run test:e2e   # end-to-end export tests in real Chrome (Playwright)
```

## Architecture

```
src/core     pure TS, no DOM/three: document schema, animation, presets, devices, camera math
src/engine   three.js renderer that draws a ResolvedScene (no notion of time or presets)
src/export   offline deterministic renderer + WebCodecs encoding (Mediabunny)
src/media    import/probe, IndexedDB storage (Dexie)
src/state    zustand stores: document (undoable) + playback
src/ui       React editor: viewport, sidebar, inspector, timeline, export dialog
```

- **The document is the contract.** `Project` is versioned JSON validated by Zod (`core/schema`), with a migration hook for future versions.
- **Channels.** Every animatable property is a flat numeric channel (`device-x.rotation.y`, `camera.distance`). New node types only need to declare their channels (`core/animation/channels.ts`).
- **Presets are functions, not baked animations.** `build(params, ctx) → curves` (`core/presets`). A clip on the timeline stores only `presetId + params`, so changing a slider regenerates the motion. Curves can be `offset` (they stack, e.g. Floating on top of Side Entrance) or `absolute`. *Convert to keyframes* bakes a clip into editable tracks.
- **`evaluate(project, t)` is pure.** The viewport and the exporter call the same function and the same `Engine`. Preview equals export.
- **Camera is an orbit rig** (target / yaw / pitch / distance / fov), so camera presets compose cleanly. *Screen Focus* maps a rectangle in screen UV space to a world-space camera pose.
- **Screen shader** (`engine/screen/ScreenMaterial.ts`): an unlit SDF rounded mask with cover/contain/fill and content zoom/pan. It is not tone mapped, so app colours stay exact.

### Adding things
- **Preset:** write one object in `core/presets/*` and add it to `registry.ts`. Its inspector UI is generated from its `params`.
- **Device:** add a spec to `core/devices/registry.ts`. GLB devices plug into the same spec through a new `builder`.

## Export: why this approach

| Approach | Verdict |
|---|---|
| `canvas.captureStream()` + MediaRecorder | ❌ Real-time capture: drops frames when the GPU stalls, variable frame rate, weak codec control |
| ffmpeg.wasm | ❌ Slow (no hardware acceleration), ~30 MB download |
| **Offline render + WebCodecs + Mediabunny** | ✅ Frame-exact, hardware encoders, MP4/WebM muxing in the browser |

How it works (`export/exporter.ts`):
1. A separate `Engine` renders on an `OffscreenCanvas` at the output resolution, independent of the viewport.
2. For each frame it evaluates `t = i / fps`, waits for the screen video frame decoded *exactly* at `t` (Mediabunny `CanvasSink`, never `<video>.currentTime`), renders, then calls `CanvasSource.add()`. That call waits whenever the encoder queue is full (backpressure).
3. Optional motion blur averages N sub-frames per frame (180° shutter).
4. MP4 uses H.264 (falling back to HEVC/VP9/AV1), WebM uses VP9 with alpha, and PNG sequences are zipped with fflate. Screen-recording audio is copied without re-encoding when the container supports its codec.
5. *Stream to file* writes through the File System Access API, so long 4K exports never sit in RAM.

Future: a server renderer (headless Chrome running the same `core` + `engine`, plus FFmpeg for ProRes 4444) can consume the same JSON document.
