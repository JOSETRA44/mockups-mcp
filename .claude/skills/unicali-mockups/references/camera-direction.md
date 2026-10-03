# Camera direction for app promo videos

Promo videos are watched on phones, often muted, for a few seconds. The camera's job is to make
one idea obvious per beat. These guidelines explain *why* certain moves work so you can adapt
them instead of copying numbers.

## Pacing

- **One idea per 1.5–3 s.** A beat = arrive, hold, leave. Viewers need ~1 s of stillness to read
  UI text, so give every focus waypoint a **hold**: two waypoints with the same framing,
  0.8–1.5 s apart.
- **Total length**: 6–10 s for a reel/ad, 15–30 s for a walkthrough. Shorter is almost always better.
- **Open fast, end calm.** The first 0.5 s decides whether people keep watching, so open with
  motion (entrance or a slow push). End on a stable hero framing that holds ≥ 1 s (good for a
  logo/CTA overlay added later in an editor).

## Easing

- Use `product` (fast start, long soft landing) for arrivals; it feels intentional and premium.
- Use `easeInOut` for moves between two holds (start and end at rest).
- `spring` adds a small overshoot: good for playful brands, too bouncy for fintech/health.
- Avoid `linear` for camera moves, except a slow continuous drift or orbit you never stop.
- The ease on a waypoint describes the move **from that waypoint to the next**.

## Shot vocabulary → tools

| Shot | How |
|---|---|
| Hero reveal | `add_motion` `hero-reveal` on the device |
| Slow push-in (adds tension) | `add_motion` `push-in`, amount 0.15–0.3 over 3–5 s |
| Pull-out reveal | `pull-out` or a path from a `focus` waypoint to a wide one |
| Feature zoom | `set_camera_path` waypoint with `focus: {x, y, size: 0.3–0.5}` |
| Three-quarter beauty shot | camera `yaw` ±25–40, `pitch` 8–15 |
| Orbit | `camera-orbit` (arc 40–90° for ads; 360 only for hardware showcases) |
| Ambient life during holds | `floating` on the device (stacks with everything) |

## Designing a journey with `set_camera_path`

1. List the 2–4 things on screen worth showing, in the order the story needs them. Estimate
   their screen UV centre (`y` 0 = top, 1 = bottom) from the screenshot — look at the image.
2. Start wide and slightly angled (e.g. `yaw: -30, pitch: 10`), so the device reads as 3D.
3. For each feature: an arrival waypoint with `focus`, then the same focus again ~1 s later (hold).
4. End wide and front-facing: `{yaw: 0, pitch: 0, focus: {x: 0.5, y: 0.5, size: 1.6, face: 0}}`
   frames the whole phone again.
5. `render_frames` at the **holds** (not just evenly spaced) to verify each feature is
   centred and readable. Pass explicit `times`.

`size` is the fraction of the screen **height** kept in frame and `w` the fraction of its
**width** (defaults to `size`). Mobile UI is usually full-width, so for a card or button use
`w: 0.95` and set `size` to the element's height plus a little margin (a balance card ≈ 0.3,
a bottom button ≈ 0.2). `size: 1` = whole screen, 1.4–1.8 = the whole phone with breathing room.
If a render shows the element cropped at the sides, raise `w`; if it looks small, lower `size`.

## Common mistakes

- **No holds**: a camera that never stops feels like a screensaver.
- **Zooming into empty UI**: check the screenshot; aim at text or the key control.
- **Overlapping moves**: zooming while an entrance is still playing makes both hard to read.
  Hold the camera wide (or drift gently) until the entrance lands, then move.
- **Too many directions**: alternate at most once (e.g. left orbit, then settle). Changing
  direction every beat reads as indecisive.
- **Fighting layers**: a camera path plus a `camera-orbit` clip both move the camera.
  `set_camera_path` removes camera clips by default for this reason; add device motions instead.
- **Background clash**: pick a background from the app's palette (a darker shade of the primary
  colour → a lighter or complementary one), or neutral dark for colourful apps.
