# Capturing material from a running app

Goal: clean, deliberate material — not a screen recording of you poking around. Explore freely,
then shoot short takes that each show **one action** and end on its result.

## Tools

| Tool | Use |
|---|---|
| `capture_targets` | Phones/emulators (`ready`) and emulator images (`bootable`) |
| `capture_open` | `{kind: "android", app: "com.pkg"}` or `{kind: "web", app: "https://…"}`. Status bar goes clean (9:41, full battery, no notifications) until `capture_close` |
| `capture_look` | Screenshot + elements (`e7 button[tap] "Notas" @x1,y1–x2,y2`). Only what is visible is listed |
| `capture_act` | One step, not recorded (explore / reach a screen). Waits for the UI to settle before returning the new look |
| `capture_still` | Clean lossless screenshot → asset (UI blocks + palette detected) |
| `capture_take` | Recorded take from steps → trimmed video asset + review sheet |
| `review_material` | One image with every still and take (frames at trim start, settled moments, end) |
| `capture_close` | Always call it: restores the device's status bar |

Steps: `{"tap": {"text": "Notas"}}`, `{"tap": {"desc": "Ver estadísticas"}}`, `{"tap": {"ref": "e7"}}`,
`{"tap": {"at": [0.5, 0.8]}}`, `{"scroll": "down", "amount": 0.5, "speed": "slow"}`,
`{"swipe": {"from": [0.39, 0.43], "to": [0.82, 0.43], "duration": 1800}}` (sliders, drags),
`{"type": "hola", "into": {"ref": "e2"}}`, `{"back": true}`, `{"key": "enter"}`, `{"wait": 800}`,
`{"waitFor": {"text": "Listo"}}`. Text matching ignores case and accents. Semantic targets wait up to 6 s to appear.

## Workflow

1. **Read the brief, find the story**: the problem → the feature → the payoff. Usually 3–5 beats.
2. **Explore** with `capture_look` / `capture_act`. Note where each beat lives and what its
   *payoff state* looks like (a number turning green, a list filling in, a confirmation).
3. **Shoot one take per beat**:
   ```json
   {"label": "Simula tu sustitutorio",
    "setup": [{"tap": {"text": "Lab"}}, {"tap": {"text": "Estadística Aplicada"}, "after": 1200}],
    "steps": [{"tap": {"text": "Examen Parcial"}, "after": 900},
              {"swipe": {"from": [0.39, 0.431], "to": [0.82, 0.431], "duration": 1800}},
              {"wait": 1200}],
    "leadIn": 800, "hold": 1500}
   ```
   The app is relaunched, `setup` runs off camera, the steps are **rehearsed** (targets resolved,
   settle times measured) and then recorded at rehearsed timing — no lookup delays on camera.
4. **Review** the take's sheet (returned by `capture_take`) or `review_material`. Re-shoot if a
   frame shows a keyboard, a spinner, a dialog, a half-finished animation or personal data.
5. **Assemble**: `set_shots` with `media` per shot (or `create_storyboard {assetIds: [...]}`).

## Direction rules (learned on real devices)

- **One action per take**, 2–5 s. A take that does three things cannot be cut to the music.
- **End on the result.** The editor holds a take's last frame, and recorders stop emitting frames
  once the screen is still, so the final state is what the shot settles on.
- **Use `fitTake: true`** for takes in shots: the take is retimed (0.75×–1.6×) so its payoff lands
  before the cut. Without it, a 3.6 s take in a 2.8 s shot cuts away before the payoff.
- **Show takes whole**: focus region `{x: 0.5, y: 0.5, size: 1.05, w: 1}` keeps the full screen in a
  9:16 frame. Then a second shot can be a **close-up on the payoff** (same take, `from` = its end,
  a small region around the result) — wide action, then close-up, reads as directed.
- **Count-ups and transitions**: wait for them (`after`/`wait`) — a look or still taken mid-animation
  shows wrong numbers. `capture_act` already waits for the screen to settle and warns when it never
  does (loading shimmer, looping animation).
- **Protected screens** (banking, DRM, some chat apps) capture as black frames: the tools warn; pick
  another screen.
- **Personal data**: prefer demo accounts. Names, IDs and grades of real people do not belong in an ad.
- **Splash screens** count as "settled": start setup with a semantic tap (it waits for the target)
  rather than a fixed wait.
