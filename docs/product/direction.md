# Product direction: shots on a musical grid

Status: adopted (October 2026). This document records the research, the thesis, and the
decisions behind the editor's structure, music support and agent parity.

## 1. What the best tools solved (and what they didn't)

| Product | What it solves well | Adopt | Where it stops |
|---|---|---|---|
| **Rotato** | A keyframe = a whole device/camera **pose with a thumbnail**; drag a card's edge for duration; easing per card in a sidebar. "Easiest timeline in 3D." | Poses as visual cards; thumbnails; per-card easing | Keyframes are still raw poses: no idea of *what* you are framing (a button, a card), no music |
| **Screen Studio** | **Zoom blocks** on a dedicated track, auto-generated from clicks, editable; zoom = "area of interest", not coordinates | A dedicated camera lane of blocks; "frame this area" instead of numbers; automatic first draft, always editable | 2D only; zoom on clicks, not on story or rhythm |
| **Shots.so** | One-click looks and **magic backgrounds derived from your content**; animation presets; huge template library | Looks as one-click bundles; palette from the screenshot | Shallow animation; no timeline power |
| **Jitter** | **Actions instead of keyframes**; presets with an *intensity* knob; easing named by feel ("Slow down", "Overshoot"); stagger and smart snapping | Human easing names; intensity on everything; snapping as a first-class aid | 2D; music is not part of the model |
| **MockRocket / Morflax / Previewed** | Browser 3D, templates first, pro controls (DOF, lighting, keyframes) behind a simple start | Template-first onboarding, pro controls disclosed progressively | Generic SaaS layouts; camera work is manual |
| **Final Cut Pro 12 / Resolve** | Beat detection shown as a **grid**: heavy lines = sections, solid = bars/major beats, dashed = minor beats; detail grows with zoom; snapping toggle | The visual hierarchy and snapping, verbatim in spirit | Built for cutting footage, not for directing a 3D camera |
| **Premiere Remix / CapCut beat sync** | Retime music to a duration by re-arranging bars; auto cuts on beats | Duration fitting to musical phrases | "Cut on every beat" feels mechanical; needs manual refinement |

The gap in the market: **nobody connects the camera story ("what we show") with the music
("when it lands")**. Every tool treats them as separate timelines, or reduces music to
"zoom on every beat".

## 2. Thesis

> A product video is a **sequence of shots** — each one shows one thing — and **music decides
> when each shot lands**.

So the editor is organised around three ideas a non-expert already understands:

1. **Shots** (camera lane): "Hero", "Focus on this area", "Angle", "Orbit", "Wide". Each shot
   is a card with a live thumbnail (Rotato), describes *what* is framed — a region of the
   screen, picked by dragging — not coordinates (Screen Studio), and has a feel-named transition
   ("Cut", "Smooth", "Slow glide").
2. **Motions** (device lanes): what the phone does — entrances, floating, spins. Presets with
   intensity (Jitter). They stack.
3. **Music** (top lane): waveform plus the beat grid. Shots, motions and keyframes **snap** to
   bars and beats. One button, **Fit to music**, aligns the existing story to the song's phrases.

Power users keep everything underneath: keyframe tracks on any channel, bake shots and motions
to keyframes, per-shot easing and timing, multi-device, JSON/MCP control.

### Why shots are better than keyframes as the primary camera tool

- A keyframe says *where the camera is*; a shot says *what the viewer sees*. "Focus on the
  balance card" survives changes to the device position, aspect ratio and phone model; a
  keyframe does not.
- Shots are the natural unit for music (a phrase), for scripts (a beat of the story) and for
  agents (a line of a storyboard).
- **The shot boundary is the hit.** A shot's `start` is the moment the camera *arrives*; the
  transition happens *before* it, at the tail of the previous shot. Snapping starts to downbeats
  makes arrivals land on the music, the way editors anticipate a cut.

## 3. Music and rhythm: how far to automate

| Layer | Automatic | Editable |
|---|---|---|
| Analysis | Tempo, beats, downbeats (4/4), bars, sections with an energy level, computed on import, in the browser | BPM and downbeat offset can be corrected (tap / nudge); analysis is stored in the project, so nothing re-runs silently |
| Grid & snapping | On by default when a song exists: shot/clip edges snap to bars, then beats | Magnet toggle; hold Alt to place freely |
| Fit to music | One command: shot boundaries go to bars (preferring section changes), the total length ends on a phrase, entrance motions land on the first downbeat, music fades out on the last bar | Every shot stays an ordinary block afterwards; re-run any time; undo |
| Accents | Off by default. "Subtle" / "Strong" adds tiny camera pushes on **downbeats of high-energy sections only**, scaled by section energy | Mode + intensity; bake to keyframes to hand-edit |
| Duration | The video length follows the story; the song is trimmed with a fade | Start offset ("start the song at the chorus"), volume, fades |

Rules that keep it musical rather than mechanical:

- **Change shots on bars, not beats.** Beats are for micro-accents; bars are for decisions.
- **Big changes on section boundaries** (verse → chorus) when one is near.
- **Energy drives intensity, not frequency.** Calm sections hold longer with gentle drift; peaks
  allow faster transitions and accents.
- **Never more than one "event" per beat.** Accents are skipped where a transition already lands.

## 4. Agents: parity without exposing complexity

Every new capability is a core command first (`set_shots`, `fit_to_music`, `set_music`,
`set_accents`, `apply_look`, …), so agents get it through MCP/CLI/HTTP automatically. The human
UI shows the *intent-level* controls (shot cards, Fit to music, looks); the full parameter
surface stays in the inspector's advanced sections and in the API.

The agent loop the architecture is designed for:

```
script + media + song ─► create_project / import_media (song analysed on import)
                      ─► set_shots (one shot per story beat, focus regions from the screenshot)
                      ─► fit_to_music ─► render_frames (defaults to each shot's hold)
                      ─► critique & adjust ─► export_video (music mixed in)
```

## 5. Identity: recognisable, not generic

- **Language**: shots, motions, music, looks. No "layers", "assets panel" or "properties" jargon
  up front.
- **Layout**: the viewport is the hero; the story lanes underneath read like a storyboard
  (thumbnails) over a living waveform. The inspector changes with what you click.
- **Feel**: the product's motion signature (`product` ease) is named **Signature** in the UI;
  the easing names describe sensations.

## 6. What shipped in this iteration

- Shots lane with live thumbnails, roll-edit retiming, shot inspector with a region picker on the
  real screenshot, feel-named arrivals; storyboard in one click; bake to keyframes.
- Song lane (waveform, sections), Final Cut–style beat grid, snapping, Fit to music, accents,
  section-based song start, grid corrections, audio in preview (audio clock) and export (AAC/Opus).
- Automatic focus regions from the screenshot (cards, buttons) feeding the storyboard.
- Looks, including "Match media" from the screenshot's palette.
- All of it as commands → MCP tools; `render_frames` defaults to one frame per shot.

## 7. Roadmap after this iteration

1. Text and logo layers (CTA end cards), animated on the musical grid.
2. Music retiming to fit a fixed duration (Remix-style bar re-arrangement).
3. Multi-format variants (9:16 / 1:1 / 16:9) from one story, like Jitter's artboards.
4. Screen content swaps on a cut (several screenshots in one story).
5. Export and analysis in Web Workers; GLB devices.
