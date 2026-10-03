# Export pipeline

## Why this design

| Approach | Verdict |
|---|---|
| `canvas.captureStream()` + MediaRecorder | ❌ Real time: drops frames whenever the GPU stalls, variable frame rate, little codec control |
| ffmpeg.wasm | ❌ No hardware acceleration, ~30 MB download, slow |
| **Offline deterministic render + WebCodecs + Mediabunny** | ✅ Frame-exact, hardware encoders, MP4/WebM muxing in the browser |

Because `evaluate(project, t)` is pure, a frame is a function of its index. A slow machine
exports more slowly, but never worse.

## The loop (`src/export/exporter.ts`)

1. Create a separate `Engine` on an `OffscreenCanvas` at the output size (`project size × scale`,
   rounded to even numbers for 4:2:0 video).
2. Preload every screen asset with frame-exact sources (Mediabunny `CanvasSink`).
3. For frame `i`: `t = i / fps` → `evaluate` → `await prepareSources(t)` → render (or render N
   sub-frames and average them for motion blur, 180° shutter) → `CanvasSource.add(t, 1/fps)`.
   `add` resolves only when the encoder has room (backpressure), so memory stays bounded.
4. Finalize the muxer. With a `FileSystemFileHandle`, bytes stream to disk (`StreamTarget`);
   otherwise they collect in memory (`BufferTarget`).

## Formats

| Format | Codec | Notes |
|---|---|---|
| MP4 | H.264 High (fallback HEVC → VP9 → AV1) | Default. Ads, social, editors. No alpha. |
| WebM | VP9 (fallback VP8 → AV1) | Keeps **alpha** when the background is transparent. |
| PNG sequence | lossless PNG in a zip | Alpha; for After Effects / DaVinci. |

Bitrate = width × height × fps × bits-per-pixel (standard 0.12, high 0.24, max 0.42): ≈ 15 /
30 / 52 Mbps at 1080×1920@30. Platforms re-encode uploads, so starting high pays off.

Audio from the screen recording is copied without re-encoding when the container supports the
codec (AAC/Opus in MP4; Opus/Vorbis in WebM).

## Colour

The renderer uses Khronos PBR Neutral tone mapping, so device materials roll off highlights
while base colours stay faithful. The screen shader is **not** tone mapped, so app UI colours
reach the video exactly as captured. Transparent pixels in screen content render as black (a
screen emits light).

## Server-side export

`POST /api/projects/:id/export` (and the MCP `export_video` tool) open `render.html` in headless
Chrome, which runs the same exporter and uploads the file back to the server. This is the path
for automation and for a future render farm. ProRes 4444 would go here (FFmpeg on the server
consuming PNG frames).

## Performance notes

- 1080×1920, 8 s, 4× motion blur: ~10 s on a mid-range laptop GPU.
- Contact sheets (`render_frames`) take ~1–4 s including page start-up.
- Next step: run the export loop in a Web Worker so the editor stays responsive during export.
