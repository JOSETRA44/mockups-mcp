---
name: unicali-mockups
description: Create and edit animated 3D device mockup videos (app promo videos, reels, TikToks, App Store previews, landing-page loops) with Unicali Mockups — put a screenshot or screen recording on a 3D phone, animate the device and the camera (hero reveals, orbits, push-ins, zooms onto a feature, full camera journeys), look at rendered frames, and export MP4/WebM/PNG. Use this skill whenever the user wants a phone/device mockup video, an animated app showcase, a "camera fly-through" of an app screen, to zoom into part of an app screenshot, or mentions Unicali, its MCP tools (create_project, set_camera_path, render_frames, export_video...) or its CLI — even if they only say "make a promo video from this screenshot".
---

# Unicali Mockups

Unicali turns app screenshots/recordings into animated 3D device videos. You drive it through
its **MCP tools** (preferred) or its **CLI**; a human can watch and edit the same project live in
the browser editor at the URL returned by `unicali_status`.

## How to reach it

- **MCP tools available** (`create_project`, `render_frames`, …): use them directly.
- **No MCP tools**: use the CLI from the repo root — `node bin/unicali.mjs <command>`
  (`help` lists everything). It auto-starts the local server. Every MCP editing tool exists as
  `node bin/unicali.mjs exec <projectId> <command> '<json args>'`.
- To give the human the live editor, tell them to open the `editor` URL from `create_project` /
  `unicali_status`. Their edits and yours sync both ways.

## The loop that produces good videos

1. **Set up** — `create_project` (optionally with a `template`), then `import_media` with the
   absolute path of the user's screenshot or recording. Videos longer than the scene extend it.
2. **Rough in the motion** — start from a template (`apply_template`) that matches the brief;
   it is faster and better-timed than building from nothing. See the template table in
   `references/presets.md`.
3. **Look at it** — `render_frames` (6 frames across the timeline by default). This is the
   step that matters most: numbers can't tell you that the phone is cropped, the zoom lands on
   empty space, or the background clashes with the app. Check framing, timing and colour.
4. **Refine** — adjust with `update_motion` (timing/params by `clipId`), `add_motion`,
   `set_camera_path` (camera journeys), `set_background`, `set_lighting`, `set_device`.
   `get_project` shows clip ids and current values. Use `batch` for several related edits so
   they apply atomically and undo as one step; `undo` reverts your last change.
5. **Look again**, then **export** — `export_video` (mp4 for ads/social, webm when the
   background is transparent, png for After Effects). Report the output path. Draft at
   `scale: 0.5` if you just need to check motion end-to-end; final at `scale: 1` (or 2 for 4K).

Render frames after every meaningful change rather than chaining many edits blind — renders
take a few seconds and catch most mistakes early.

## Mental model (read once)

- **Coordinates**: a phone is ~2 world units tall, centred at the origin. Angles in degrees,
  times in seconds. Screen regions use UV: `x, y` in 0..1 from the **top-left** of the screen.
- **Rest pose + animation**: `set_device`/`set_camera` set the rest pose. Motions and keyframes
  animate on top of it.
- **Motions (presets) are live clips** with params. They **stack**: offsets from several clips
  add up, so "entrance + floating + camera move" composes naturally. Device presets target a
  device; camera presets always target the camera.
- **Keyframes** (`set_keyframe`, `set_camera_path`) override the rest value of a channel;
  device/camera motion offsets still add on top. `set_camera_path` by default removes camera
  *motions* so the path is exactly what you specified.
- **Camera** is an orbit rig: `target`, `yaw` (0 = front, + orbits to the right), `pitch`
  (+ = from above), `distance`, `fov`. `frame_device` resets to a clean hero framing.

## Camera journeys

`set_camera_path` is the tool for "fly through the app" requests. Each waypoint can use
`focus: {x, y, size}` to frame a region of the screen (e.g. a button at the bottom:
`{x: 0.5, y: 0.88, size: 0.3}`), so you never need to compute 3D positions yourself.
Read `references/camera-direction.md` before designing one — it covers pacing, holds,
easing and the shot vocabulary that makes these feel professional rather than robotic.

## Reference files

- `references/presets.md` — every preset with params/ranges, templates, devices, eases,
  channels and formats (generated from code: always accurate).
- `references/commands.md` — every editing command and its arguments (generated).
- `references/camera-direction.md` — how to design camera moves and pacing for ads.
- `references/recipes.md` — complete worked examples (feature zoom, multi-device, transparent
  export, screen recording walkthrough).

## When things go wrong

- Tool errors are written for you: they name the bad argument and the valid options. Fix and
  retry rather than guessing.
- "No project yet": call `create_project` or `use_project` first.
- Export says the browser cannot encode: Chrome must be installed (or `UNICALI_CHROME` set);
  try `format: "webm"` as a fallback.
- Phone looks cropped or tiny: `frame_device` (optionally `fill: 0.5–0.75`) then re-render.
