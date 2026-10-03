# Extending Unicali

Everything below follows one principle: **add it once in core, and every client gets it**.

## Add a motion preset

1. Write the preset in `src/core/presets/` (device presets in `device.ts`, camera ones in
   `camera.ts`, or a new file):

```ts
export const nod: Preset = {
  id: 'nod',
  name: 'Nod',
  description: 'Tips forward and back, like agreeing.',
  target: 'device',
  category: 'emphasis',
  defaultDuration: 1.2,
  params: [
    { key: 'angle', label: 'Angle', type: 'number', min: 2, max: 30, step: 1, default: 10, unit: '°' },
    easeParam('easeInOut'),
  ],
  build(p) {
    const a = num(p, 'angle', 10)
    return [{
      channel: 'rotation.x',
      mode: 'offset', // offsets stack with other motions
      sample: keys([{ u: 0, v: 0 }, { u: 0.5, v: a }, { u: 1, v: 0 }], str(p, 'ease')),
    }]
  },
}
```

2. Add it to `PRESETS` in `src/core/presets/registry.ts`.
3. `npm test` (the "all presets build without NaN" test covers it) and `npm run docs`.

The inspector UI is generated from `params`, the MCP `add_motion` enum picks it up, and the
catalog lists it. Optionally give it an icon in `PRESET_ICONS` (`src/ui/panels/Sidebar.tsx`).

`sample(u)` maps clip progress `u ∈ [0,1]` to a value and is held outside the clip. Use
`keys([...])` for keyframed curves or any function (e.g. a sine for loops). `ctx` gives you the
device spec/pose, the base camera and the aspect ratio so motion can scale to the scene.

## Add a command

```ts
export const setDeviceScreenBrightness = defineCommand({
  name: 'set_screen_brightness',
  summary: 'Set screen brightness',
  description: '1 = as captured; >1 brightens for dark scenes. Units: multiplier.',
  args: z.object({ deviceId: z.string().optional(), value: z.number().min(0).max(3) }),
  run: (p, a) => edit(p, (d) => { /* mutate the draft */ }),
})
```

Register it in `COMMANDS` (`src/core/commands/index.ts`), add a test in `commands.test.ts`,
run `npm run docs`. It is now an MCP tool, a CLI `exec` target, an HTTP command, and callable
from the UI with `exec('set_screen_brightness', {...})`.

Guidelines: descriptions are for agents (units, ranges, gotchas); validate references and throw
`CommandError('NOT_FOUND' | 'INVALID_ARGS' | 'CONFLICT', message)` with the valid options;
never mutate the input (use `edit`).

## Add a template

Append to `TEMPLATES` in `src/core/commands/templates.ts`. A template is a function composed of
commands, so it stays valid when presets change. The template test applies every template and
validates the result.

## Add a device

Add a `DeviceSpec` to `src/core/devices/registry.ts` (dimensions in world units, finishes). For
a new shape family, add a builder in `src/engine/devices/` and a `builder` value; the engine
dispatches on it. Screen framing (Screen Focus, camera-path focus) uses only the spec's
`screen` dimensions, so it works automatically.

## Add a scene node type (text, logo, image, 3D model)

1. Schema: add a node to the `SceneNode` union and bump `PROJECT_VERSION` with a migration.
2. Channels: declare its animatable channels in `src/core/animation/channels.ts` and extend
   `resolveScene` / `ResolvedScene`.
3. Engine: build and sync the three.js object in `Engine.sync`.
4. Commands: `add_<node>`, `set_<node>`; the UI gets an inspector section.

Presets and keyframes then work on the new node through its channels.

## Add a locale

Copy `src/i18n/en.ts` to `xx.ts`, translate, register it in `src/i18n/index.ts`.
