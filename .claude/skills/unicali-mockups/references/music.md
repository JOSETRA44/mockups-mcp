# Music and rhythm

## What the analysis gives you

`import_media` on a song returns (and `get_project` → `music` keeps):

- `bpm` and `barSeconds` (4/4 assumed): a bar at 120 BPM is 2 s.
- `sections`: `{label, energy (0..1), songStart, songEnd}`. Labels: `intro`, `calm`, `build`,
  `peak`, `outro`. Energy is relative within the song.
- `barsInVideo`: bar times in **video** time (after the song offset). Shots should start on these.

## Musical rules Unicali follows (and you should too)

- **Change shots on bars, not beats.** Beats are for micro-accents; bars are for decisions.
- **Big changes on section boundaries.** `fit_to_music` snaps a cut onto a section change
  when one is within a bar.
- **Energy drives intensity, not frequency.** Calm sections: longer shots, `drift`/`hold`, smooth
  arrivals (0.8–1.6 s). Peak sections: shorter shots (1–2 bars), quick arrivals (0.3–0.5 s), push moves.
- **One event per beat.** Accents are skipped where a shot change already lands.

## Choosing where the song starts

Ads usually start at the strongest part. Pick a section with high energy (often the first
`peak`) and `set_music {offset: <its songStart>}` before `fit_to_music`. For a calm opening,
start at the intro and let the cut to the first focus land on the peak's start.

## Accents

`set_music {accents: "subtle" | "strong"}` adds a tiny camera push on downbeats of
energetic sections only (energy ≥ 0.55), scaled by energy. Use `subtle` for most product
videos and `strong` for hype/sports/gaming. Leave it `off` for calm or premium brands.

## Fixing the grid

The detector is reliable on pop/electronic music with a clear kick; it can be off on rubato,
very syncopated or ambient tracks.

| Symptom | Fix |
|---|---|
| Tempo clearly wrong (double/half) | `set_tempo {bpm: <correct>, firstBeat: <song time of a beat>}` |
| Bars start one beat early or late | `set_tempo {shiftDownbeat: 1}` (or -1, 2, 3) |
| Everything slightly early or late | `set_tempo {nudge: 0.02}` (seconds, ±) |

Then re-run `fit_to_music`.

## Length

The video length follows the story: `fit_to_music` rounds the total to whole phrases (4 bars
by default; `phrase: 2` for shorter cuts) and fades the song out over the last bar. To make a
fixed-length cut (e.g. 15 s at 120 BPM ≈ 7.5 bars → use 8 bars = 16 s), size the shots so
their bar counts add up, then fit.
