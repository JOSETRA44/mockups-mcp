---
name: unicali-mockups
description: Create and edit animated 3D device mockup videos (app promo videos, reels, TikToks, App Store previews, landing-page loops) with Unicali Mockups — capture clean screenshots and directed takes straight from a running Android app or web page, put them on a 3D phone, tell the story as camera shots (hero, focus on a feature, angle, orbit), sync it to a song's beats and sections, look at rendered frames, and export MP4/WebM/PNG with music. Use this skill whenever the user wants a phone/device mockup video, an animated app showcase, a video from a script/storyboard plus screenshots, a promo cut to music, zooms onto parts of an app screen, or mentions Unicali, its MCP tools (create_project, set_shots, fit_to_music, render_frames, export_video...) or its CLI — even if they only say "make a promo video from this screenshot and this song".
---

# Unicali Mockups

Unicali turns app screenshots/recordings and a song into animated 3D device videos. You drive
it through its **MCP tools** (preferred) or its **CLI**; a human can watch and edit the same
project live in the browser editor (URL from `create_project` / `unicali_status`).

## How to reach it

- **MCP tools available** (`create_project`, `set_shots`, …): use them directly.
- **No MCP tools**: from the repo root, `node bin/unicali.mjs <command>` (`help` lists all).
  Every editing tool exists as `node bin/unicali.mjs exec <projectId> <tool> '<json>'`;
  several at once with `batch <projectId> steps.json`.

## The model: shots on a musical grid

- **Shots** (camera story) say *what the viewer sees*, in order: `hero` (whole device),
  `focus` (a region of the screen), `angle` (3/4 beauty view), `wide`, `orbit`. Each has a
  move (`hold`, `push`, `pull`, `drift`, `orbit`) and an arrival (`transition` seconds + `ease`).
  A shot's start is when the camera **arrives**, so starts on bars = arrivals on the beat.
- **Motions** say what the *device* does (entrances, floating, spins). They stack.
- **Music**: importing a song analyses tempo, bars and energy sections. `fit_to_music` moves
  shot changes onto bars (preferring section changes) and ends on a full phrase.
- **Looks** set background + lighting + finish in one step; `match-media` derives them from
  the screenshot's colours.

## The loop that produces good videos

1. **Set up**: `create_project`, then get material:
   - from files: `import_media` (screenshots/recordings; UI blocks are detected), or
   - **from the running app** (brief + app, no files): `capture_open` → explore with
     `capture_look`/`capture_act` → one `capture_take` per story beat (plus `capture_still` where a
     static screen is enough) → `review_material` → `capture_close`. Read `references/capture.md`
     first: it holds the take-direction rules that make material look deliberate.
   Then `import_media` the song (tempo and sections are returned).
2. **Propose the story**:
   - quick: `create_storyboard` (angle → focus on each detected UI block → hero), or
   - from a script/brief: `set_shots` with one shot per story beat (see below).
   Add device motions if useful (`add_motion` `hero-reveal` at 0, `floating` after).
3. **Fit to the music**: `fit_to_music`. Optionally start the song at its best part
   (`set_music` `offset` = a section start) *before* fitting, and add `accents: "subtle"`
   for energetic songs.
4. **Look**: `render_frames` with no `times` renders one frame per shot at its settled moment.
   Check that each focus frames the intended UI, nothing important is cropped, and the look
   suits the app. Numbers can't tell you this; the picture can.
5. **Refine** with `update_shot` (by `shotId` from `get_project`): region `{x, y, size, w}`,
   `kind`, `yaw/pitch`, `move`, `transition`. Re-run `fit_to_music` after changing lengths.
   `apply_look` to change the mood. `undo` reverts your last change.
6. **Export**: `export_video` (mp4 for social/ads; webm/png for transparency). The song is mixed
   in with its fades. Report the path. Draft with `scale: 0.5` if you only need to check timing.

## From a script to shots

Turn each line of the script into one shot. Examples:

| Script line | Shot |
|---|---|
| "Meet Budget" / opening | `angle` (or `wide`), 1–2 bars |
| "See your balance at a glance" | `focus` on the balance card, `move: "drift"` |
| "Send money in one tap" | `focus` on the button, `transition: 0.4` (quick) |
| "Your money, simplified" / ending | `hero`, `move: "push"` |

Get regions from the detected blocks (`get_project` → `assets[].regions`, top to bottom) or by
looking at the screenshot yourself (UV from the top-left). Full-width UI wants `w: 0.95`;
`size` = the element height plus a little margin. Give each shot about 2 bars (≈ 4 s at
120 BPM); `fit_to_music` will round to bars and phrases.

## Reference files

- `references/capture.md`: capturing from Android/web, take direction, review, pitfalls.
- `references/music.md`: how sync works, choosing the song start, accents, fixing the beat grid.
- `references/camera-direction.md`: pacing, holds, easing and shot vocabulary for ads.
- `references/recipes.md`: complete worked examples (script + song, transparent loop, multi-device).
- `references/presets.md`: presets, shot kinds, looks, templates, devices (generated from code).
- `references/commands.md`: every command and argument (generated).

## When things go wrong

- Tool errors name the bad argument and the valid options (misspelled keys are rejected). Fix and retry.
- "No project yet": `create_project` or `use_project`.
- No bars after importing a song (`analysed: false` or no `barsInVideo`): `set_tempo` with the BPM.
- Shots feel off the beat: check `get_project` → `music.barsInVideo`; if the grid is late or early,
  `set_tempo` `nudge`; if bars start on the wrong beat, `shiftDownbeat`.
- Export cannot encode: Chrome must be installed (or `UNICALI_CHROME` set); try `format: "webm"`.
