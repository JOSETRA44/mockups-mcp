# Recipes

Complete, tested sequences.

## 0. Script + screenshot + song → promo (the main workflow)

```text
create_project  {"name": "Budget – launch"}
import_media    {"path": "C:/Users/me/Desktop/home.png"}      # detects UI blocks (cards, buttons)
import_media    {"path": "C:/Users/me/Music/track.mp3"}       # returns bpm + sections
set_music       {"offset": 8.2}                                 # start at the first "peak" section (optional)
apply_look      {"look": "match-media"}
set_shots {"shots": [
  {"kind": "angle", "duration": 4},
  {"kind": "focus", "duration": 4, "region": {"x": 0.5, "y": 0.26, "size": 0.3, "w": 0.95}},
  {"kind": "focus", "duration": 4, "region": {"x": 0.5, "y": 0.92, "size": 0.16, "w": 0.95}, "transition": 0.4},
  {"kind": "hero",  "duration": 4, "move": "push"}
]}
add_motion      {"preset": "hero-reveal", "start": 0, "duration": 1.8}
fit_to_music    {}
render_frames   {}                                              # one frame per shot hold
export_video    {"format": "mp4"}
```

Quicker variant: replace `set_shots` with `create_storyboard {}` (it uses the detected blocks).
 Arguments are shown as MCP tool calls; with the CLI use
`node bin/unicali.mjs exec <projectId> <tool> '<json>'` (or `batch <id> steps.json`).

## 1. Feature zoom ad from a screenshot (9:16, ~8 s)

The camera stays wide (drifting slightly) until the entrance lands at 2 s, so the two moves don't fight.
Cards and buttons span the full screen width, hence `w: 0.95`.

```text
create_project  {"name": "Budget app – savings"}
import_media    {"path": "C:/Users/me/Desktop/home.png"}
set_background  {"kind": "gradient", "color": "#0b1f3a", "color2": "#2f6bff", "angle": 160}
batch {"steps": [
  {"command": "add_motion", "args": {"preset": "hero-reveal", "start": 0, "duration": 2}},
  {"command": "add_motion", "args": {"preset": "floating", "start": 2, "duration": 6}},
  {"command": "set_camera_path", "args": {"waypoints": [
    {"time": 0,   "yaw": -28, "pitch": 10},
    {"time": 2.0, "yaw": -18, "pitch": 6, "ease": "easeInOut"},
    {"time": 3.2, "focus": {"x": 0.5, "y": 0.27, "size": 0.32, "w": 0.95}},
    {"time": 4.3, "focus": {"x": 0.5, "y": 0.27, "size": 0.32, "w": 0.95}, "ease": "easeInOut"},
    {"time": 5.6, "focus": {"x": 0.5, "y": 0.91, "size": 0.2, "w": 0.95}},
    {"time": 6.5, "focus": {"x": 0.5, "y": 0.91, "size": 0.2, "w": 0.95}, "ease": "easeInOut"},
    {"time": 8,   "yaw": 0, "pitch": 0, "focus": {"x": 0.5, "y": 0.5, "size": 1.6, "face": 0}}
  ]}}
]}
render_frames   {"times": [1.2, 2.2, 3.8, 6.0, 7.9]}   # check the holds, not just even spacing
export_video    {"format": "mp4"}
```

## 2. Screen-recording walkthrough

```text
create_project {"name": "Onboarding walkthrough", "template": "app-launch"}
import_media   {"path": "/Users/me/Movies/onboarding.mov"}     # duration grows to the video length
update_motion  {"clipId": "<push-in clip id from get_project>", "duration": 12}
render_frames  {}
export_video   {"format": "mp4", "includeAudio": true}
```

The recording plays on the screen in sync with the timeline and loops if the scene is longer.

## 3. Transparent hero for a landing page

```text
set_background {"kind": "transparent"}
apply_template {"template": "orbit-showcase"}
export_video   {"format": "webm"}        # VP9 with alpha; use "png" for an image sequence
```

## 4. Two devices side by side

```text
set_device  {"position": [-0.75, 0, 0], "rotation": [0, 12, 0]}
add_device  {"model": "phone-android", "position": [0.75, 0, -0.2], "rotation": [0, -12, 0]}
import_media {"path": "/abs/android.png", "deviceId": "<new deviceId>"}
frame_device {"fill": 0.45}
set_camera  {"target": [0, 0, 0]}
add_motion  {"preset": "floating", "target": "<first deviceId>"}
add_motion  {"preset": "floating", "target": "<new deviceId>", "params": {"cycles": 1.5}}
add_motion  {"preset": "camera-orbit", "params": {"angle": 40}}
```

## 5. Zoom into the app content without moving the camera

Keyframe the screen's own 2D zoom (the phone stays put; the UI scales inside the screen):

```text
set_keyframe {"path": "<deviceId>.screen.zoom", "time": 1, "value": 1}
set_keyframe {"path": "<deviceId>.screen.zoom", "time": 2.5, "value": 2.2, "ease": "product"}
set_keyframe {"path": "<deviceId>.screen.panY", "time": 1, "value": 0}
set_keyframe {"path": "<deviceId>.screen.panY", "time": 2.5, "value": 0.25}
```
