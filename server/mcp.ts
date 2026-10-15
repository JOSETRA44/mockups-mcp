import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { COMMANDS } from '../src/core/commands'
import { TEMPLATES } from '../src/core/commands/templates'
import { shotHoldTimes } from '../src/core/shots/shots'
import { StepSchema, TakeSchema } from '../src/core/capture/steps'
import type { CaptureLook } from './client'
import { VERSION } from './config'
import { connect, type UnicaliClient } from './client'

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
const text = (v: unknown): Content => ({ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) })

/**
 * MCP server for Unicali Mockups. Tools fall into four groups:
 *  - session/projects: status, list/create/use/get/delete projects, catalog
 *  - media: import a local file onto a device screen
 *  - editing: one tool per core command (generated), plus batch/undo/redo
 *  - seeing & output: sample_motion (numbers), render_frames (images), export_video (files)
 * Every tool takes an optional projectId; it defaults to the session's current project.
 */
export async function runMcpServer() {
  const { client, server: embedded } = await connect()
  const health = await client.health()
  let current: string | null = null

  const mcp = new McpServer(
    { name: 'unicali-mockups', version: VERSION },
    {
      instructions:
        `Unicali Mockups: animated 3D device mockups for app promo videos. Editor (for the human): ${health.url}. ` +
        'Material: import_media (local files) or capture it from a running app (capture_open → capture_look/capture_act to explore → capture_still / capture_take → review_material). ' +
        'Workflow: create_project (or use_project) → material → set_shots with per-shot media (or create_storyboard with assetIds) → import a song → fit_to_music → ' +
        'render_frames to LOOK at the result (always check visually before exporting) → adjust → export_video. ' +
        'Units: phone ≈ 2 world units tall, angles in degrees, times in seconds, screen regions in UV (0..1 from top-left). ' +
        'Call get_catalog once to learn presets, params, devices and templates.',
    },
  )

  const pid = async (projectId?: string) => {
    if (projectId) return (current = projectId)
    if (current) return current
    const { projects } = await client.listProjects()
    if (projects[0]) return (current = projects[0].id)
    throw new Error('No project yet. Call create_project first.')
  }

  const safe = <A>(fn: (a: A) => Promise<Content[]>) => async (a: A) => {
    try {
      return { content: await fn(a) }
    } catch (err) {
      return { content: [text(`Error: ${(err as Error).message}`)], isError: true }
    }
  }

  const projectId = z.string().optional().describe('Project id (defaults to the current project)')

  // ---- Session & projects --------------------------------------------------------
  mcp.registerTool('unicali_status', {
    title: 'Status',
    description: 'Server URL (open it in a browser to see the editor live), workspace folder, version and current project.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => [text({ ...(await client.health()), currentProject: current, editor: `${client.base}/?project=${current ?? ''}` })]))

  mcp.registerTool('get_catalog', {
    title: 'Catalog',
    description: 'Presets (with params and ranges), devices and finishes, templates, eases, formats, animatable channels and every command schema.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => [text(await client.catalog())]))

  mcp.registerTool('list_projects', {
    title: 'List projects',
    description: 'Projects in the workspace, most recent first.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => [text(await client.listProjects())]))

  mcp.registerTool('create_project', {
    title: 'Create project',
    description: `Creates a project (9:16, 30 fps, one phone) and makes it current. Optional template: ${TEMPLATES.map((t) => t.id).join(', ')}.`,
    inputSchema: { name: z.string().optional(), template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]).optional() },
  }, safe(async (a: { name?: string; template?: string }) => {
    const { project } = await client.createProject(a.name, a.template)
    current = project.id
    return [text({ projectId: project.id, editor: `${client.base}/?project=${project.id}`, summary: await client.describe(project.id) })]
  }))

  mcp.registerTool('use_project', {
    title: 'Use project',
    description: 'Makes an existing project the default for subsequent tool calls.',
    inputSchema: { projectId: z.string() },
  }, safe(async (a: { projectId: string }) => {
    await client.getProject(a.projectId)
    current = a.projectId
    return [text({ currentProject: current, summary: await client.describe(current) })]
  }))

  mcp.registerTool('get_project', {
    title: 'Get project',
    description: 'Compact summary (devices, camera, motions with clipIds, keyframe tracks, assets). full=true returns the raw project JSON.',
    inputSchema: { projectId, full: z.boolean().default(false) },
    annotations: { readOnlyHint: true },
  }, safe(async (a: { projectId?: string; full?: boolean }) => {
    const id = await pid(a.projectId)
    return [text(a.full ? await client.getProject(id) : await client.describe(id))]
  }))

  mcp.registerTool('delete_project', {
    title: 'Delete project',
    description: 'Permanently deletes a project folder, its assets and renders.',
    inputSchema: { projectId: z.string(), confirm: z.literal(true).describe('Must be true') },
    annotations: { destructiveHint: true },
  }, safe(async (a: { projectId: string }) => {
    await client.deleteProject(a.projectId)
    if (current === a.projectId) current = null
    return [text({ deleted: a.projectId })]
  }))

  // ---- Media ---------------------------------------------------------------------
  mcp.registerTool('import_media', {
    title: 'Import local media',
    description:
      'Copies a local file into the project. Screenshots/recordings (png, jpg, webp, gif, mp4, mov, webm) go on the device screen (a colour palette is extracted for apply_look "match-media"); ' +
      'songs (mp3, wav, m4a, aac, ogg, flac) become the music track and are analysed: tempo, bars and energy sections come back so you can plan shots on the music. ' +
      'Video longer than the scene extends the duration. Returns the assetId.',
    inputSchema: {
      projectId,
      path: z.string().describe('Absolute path to a local file'),
      deviceId: z.string().optional(),
      assign: z.boolean().default(true).describe('Show it on the device screen'),
    },
  }, safe(async (a: { projectId?: string; path: string; deviceId?: string; assign?: boolean }) => {
    const id = await pid(a.projectId)
    const out = await client.importFile(id, a.path, { deviceId: a.deviceId, assign: a.assign }) as Record<string, any>
    // Keep the reply small: tempo and sections are what an agent plans with.
    const an = out.analysis
    return [text({
      asset: out.asset,
      revision: out.revision,
      ...(an ? { music: { bpm: an.bpm, barSeconds: +(240 / an.bpm).toFixed(3), bars: an.bars.length, sections: an.sections } } : {}),
    })]
  }))

  // ---- Editing: one tool per core command (generated, so new commands appear automatically)
  for (const cmd of COMMANDS) {
    const shape = (cmd.args as unknown as z.ZodObject<z.ZodRawShape>).shape
    mcp.registerTool(cmd.name, {
      title: cmd.summary,
      description: `${cmd.summary}. ${cmd.description}`,
      // Strict: a misspelled argument is reported to the agent instead of silently dropped.
      inputSchema: z.object({ projectId, ...shape }).strict(),
    }, safe(async (a: Record<string, unknown>) => {
      const { projectId: p, ...args } = a
      const id = await pid(p as string | undefined)
      const out = await client.exec(id, cmd.name, args)
      return [text({ ok: true, revision: out.revision, result: out.result, project: out.summary })]
    }))
  }

  mcp.registerTool('batch', {
    title: 'Run several commands atomically',
    description: 'Runs a list of {command, args} in order as one change (one undo step). If any step fails nothing is applied.',
    inputSchema: {
      projectId,
      steps: z.array(z.object({ command: z.enum(COMMANDS.map((c) => c.name) as [string, ...string[]]), args: z.record(z.string(), z.unknown()).default({}) })).min(1).max(100),
    },
  }, safe(async (a: { projectId?: string; steps: { command: string; args?: unknown }[] }) => {
    const id = await pid(a.projectId)
    return [text(await client.batch(id, a.steps))]
  }))

  for (const dir of ['undo', 'redo'] as const) {
    mcp.registerTool(dir, {
      title: dir === 'undo' ? 'Undo' : 'Redo',
      description: `${dir === 'undo' ? 'Reverts' : 'Re-applies'} the last change made through the API (server-side history, 50 steps).`,
      inputSchema: { projectId },
    }, safe(async (a: { projectId?: string }) => {
      const id = await pid(a.projectId)
      return [text(dir === 'undo' ? await client.undo(id) : await client.redo(id))]
    }))
  }

  // ---- Seeing & output -----------------------------------------------------------
  mcp.registerTool('sample_motion', {
    title: 'Sample motion numerically',
    description: 'Resolved camera position/target and device poses at the given times. Cheap way to sanity-check timing without rendering.',
    inputSchema: { projectId, times: z.array(z.number().min(0)).min(1).max(200) },
    annotations: { readOnlyHint: true },
  }, safe(async (a: { projectId?: string; times: number[] }) => [text(await client.sample(await pid(a.projectId), a.times))]))

  mcp.registerTool('render_frames', {
    title: 'Render frames (see the result)',
    description:
      'Renders frames with the real engine in headless Chrome and returns them as one contact-sheet image (labelled with times). ' +
      'Default: one frame per shot at its settled moment (or 6 evenly spread frames without shots). Use this to visually verify framing and motion before exporting.',
    inputSchema: {
      projectId,
      times: z.array(z.number().min(0)).max(24).optional().describe('Seconds; default 6 evenly spaced'),
      width: z.number().int().min(64).max(1920).optional().describe('Tile width in px (default 320 for sheets, 720 for one frame)'),
      columns: z.number().int().min(1).max(8).optional(),
      outputPath: z.string().optional().describe('Also save the PNG to this absolute path'),
    },
    annotations: { readOnlyHint: true },
  }, safe(async (a: { projectId?: string; times?: number[]; width?: number; columns?: number; outputPath?: string }) => {
    const id = await pid(a.projectId)
    const { project } = await client.getProject(id)
    const d = project.settings.duration
    // Default: each shot's settled moment (what the viewer actually sees), else 6 even samples.
    const times = a.times?.length ? a.times
      : project.shots.length ? shotHoldTimes(project.shots).slice(0, 12)
      : Array.from({ length: 6 }, (_, i) => +((d * (i + 0.5)) / 6).toFixed(2))
    const png = await client.frames(id, { times, width: a.width ?? (times.length > 1 ? 320 : 720), columns: a.columns ?? Math.min(6, times.length), outputPath: a.outputPath })
    return [
      { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      text(`Frames at ${times.map((t) => `${t}s`).join(', ')} of ${d}s${a.outputPath ? ` · saved to ${a.outputPath}` : ''}`),
    ]
  }))

  mcp.registerTool('export_video', {
    title: 'Export video',
    description:
      'Renders the full animation to a file. mp4 = H.264 (ads, social); webm = VP9 with alpha when the background is transparent; png = zipped PNG sequence. ' +
      'Default location: <workspace>/projects/<id>/renders/. Returns the file path. Long/4K exports can take minutes.',
    inputSchema: {
      projectId,
      format: z.enum(['mp4', 'webm', 'png']).default('mp4'),
      scale: z.number().min(0.25).max(4).default(1).describe('Resolution multiplier (1 = project size, 2 = double)'),
      fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).optional(),
      quality: z.enum(['standard', 'high', 'max']).default('high'),
      motionBlur: z.number().int().min(1).max(16).default(1).describe('Sub-frames per frame (1 = off, 4–8 = cinematic)'),
      includeAudio: z.boolean().default(true),
      outputPath: z.string().optional().describe('Absolute path with the right extension (.mp4/.webm/.zip)'),
      overwrite: z.boolean().default(false),
    },
  }, safe(async (a: Record<string, unknown> & { projectId?: string }) => {
    const { projectId: p, ...opts } = a
    const id = await pid(p as string | undefined)
    if (opts.fps === undefined) opts.fps = (await client.getProject(id)).project.settings.fps
    return [text(await client.export(id, opts))]
  }))

  // ---- Capture: material from a running app ------------------------------------------
  let captureSession: string | null = null
  const sid = async (sessionId?: string) => {
    if (sessionId) return (captureSession = sessionId)
    if (captureSession) return captureSession
    const { sessions } = await client.captureSessions()
    if (sessions[0]) return (captureSession = sessions[0].sessionId)
    throw new Error('No capture session. Call capture_open first.')
  }
  const lookContent = (l: CaptureLook, note?: string): Content[] => [
    { type: 'image', data: l.png, mimeType: 'image/png' },
    text(
      [
        note,
        `${l.target} · ${l.foreground}${l.warning ? ` · ⚠ ${l.warning}` : ''} · ${l.size.width}×${l.size.height}`,
        'Elements (ref role[flags] "label" @x1,y1–x2,y2 normalised):',
        ...l.elements,
      ].filter(Boolean).join('\n'),
    ),
  ]
  const sessionId = z.string().optional().describe('Capture session (defaults to the current one)')

  mcp.registerTool('capture_targets', {
    title: 'List capture targets',
    description: 'Connected Android phones and emulators (ready) and emulator images that can be booted (bootable).',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, safe(async () => [text(await client.captureTargets())]))

  mcp.registerTool('capture_open', {
    title: 'Open a capture session on an app',
    description:
      'Connects to a device (default: the first connected phone, else boots an emulator image), optionally installs an APK, launches the app and switches the status bar ' +
      'to a clean presentation (9:41, full battery/signal, no notifications; restored on capture_close). Returns the first look.',
    inputSchema: {
      target: z.string().optional().describe('Target id from capture_targets (serial, or avd:<name>)'),
      app: z.string().optional().describe('Android package, e.g. com.example.app'),
      install: z.string().optional().describe('Absolute path to an APK to install first'),
      clean: z.boolean().default(true),
    },
  }, safe(async (a: { target?: string; app?: string; install?: string; clean?: boolean }) => {
    const look = await client.captureOpen({ kind: 'android', ...a })
    captureSession = look.sessionId
    return lookContent(look, `Session ${look.sessionId} open.`)
  }))

  mcp.registerTool('capture_look', {
    title: 'Look at the device screen',
    description: 'Screenshot plus the semantic elements on screen (refs usable in capture_act / takes). Use it to explore before shooting.',
    inputSchema: { sessionId },
    annotations: { readOnlyHint: true },
  }, safe(async (a: { sessionId?: string }) => lookContent(await client.captureLook(await sid(a.sessionId)))))

  mcp.registerTool('capture_act', {
    title: 'Interact with the app (not recorded)',
    description:
      'Performs one step to explore or to reach a screen: {"tap": {"text": "Notas"}}, {"tap": {"ref": "e4"}}, {"tap": {"at": [0.5, 0.8]}}, {"scroll": "down"}, ' +
      '{"type": "hola", "into": {"ref": "e2"}}, {"back": true}, {"key": "enter"}, {"waitFor": {"text": "Listo"}}, {"launch": "com.pkg"}. Returns the new look.',
    inputSchema: { sessionId, step: StepSchema, look: z.boolean().default(true) },
  }, safe(async (a: { sessionId?: string; step: unknown; look?: boolean }) => {
    const out = await client.captureAct(await sid(a.sessionId), a.step, a.look !== false)
    return 'png' in out ? lookContent(out) : [text(out)]
  }))

  mcp.registerTool('capture_still', {
    title: 'Capture a clean screenshot as material',
    description: 'Saves the current screen (lossless, clean status bar) into the project as an image asset; UI blocks and colours are detected. Waits for the UI to settle first.',
    inputSchema: { sessionId, projectId, label: z.string().min(1).max(80).describe('What it shows, e.g. "Grades overview"') },
  }, safe(async (a: { sessionId?: string; projectId?: string; label: string }) => [text(await client.captureStill(await sid(a.sessionId), await pid(a.projectId), a.label))]))

  mcp.registerTool('capture_take', {
    title: 'Shoot a directed take (recorded interaction)',
    description:
      'Records one deliberate interaction as a video asset. The app is relaunched, `setup` steps bring it to the start state (not recorded), the on-camera `steps` are rehearsed once ' +
      '(targets resolved, settle times measured) and then recorded with a lead-in and a held ending. The take is trimmed automatically and its settled moments are found. ' +
      'Keep takes short and about ONE action (open a screen, scroll a list, type a search). Returns the asset and a review sheet of its key frames.',
    inputSchema: { sessionId, projectId, take: TakeSchema },
  }, safe(async (a: { sessionId?: string; projectId?: string; take: unknown }) => {
    const id = await pid(a.projectId)
    const out = await client.captureTake(await sid(a.sessionId), id, a.take)
    const sheet = await client.material(id, { assetIds: [String(out.asset.id)], tileWidth: 140 })
    return [{ type: 'image', data: sheet.toString('base64'), mimeType: 'image/png' }, text({ asset: out.asset, performed: out.performed })]
  }))

  mcp.registerTool('capture_close', {
    title: 'Close the capture session',
    description: 'Restores the device (status bar back to normal) and ends the session.',
    inputSchema: { sessionId },
  }, safe(async (a: { sessionId?: string }) => {
    const id = await sid(a.sessionId)
    await client.captureClose(id)
    if (captureSession === id) captureSession = null
    return [text({ closed: id })]
  }))

  mcp.registerTool('review_material', {
    title: 'Review the project material',
    description: 'One image with every still and take of the project (takes show their trimmed start, settled moments and end), labelled with asset ids — use it to choose what goes in the cut.',
    inputSchema: { projectId, assetIds: z.array(z.string()).optional() },
    annotations: { readOnlyHint: true },
  }, safe(async (a: { projectId?: string; assetIds?: string[] }) => {
    const png = await client.material(await pid(a.projectId), { assetIds: a.assetIds })
    return [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }]
  }))


  // ---- Resources & prompts ---------------------------------------------------------
  mcp.registerResource('catalog', 'unicali://catalog', { title: 'Unicali catalog', mimeType: 'application/json' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await client.catalog(), null, 2) }],
  }))

  mcp.registerPrompt('app-promo', {
    title: 'Make an app promo video',
    description: 'Guided workflow: from a local screenshot/recording to an exported promo video.',
    argsSchema: { media: z.string().describe('Absolute path to a screenshot or screen recording'), style: z.string().optional() },
  }, ({ media, style }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text:
          `Create an app promo video with Unicali from ${media}${style ? ` in this style: ${style}` : ''}. ` +
          'Steps: create_project → import_media → pick a template that fits (apply_template) → render_frames and critique framing/timing → ' +
          'refine with add_motion/update_motion/set_camera_path/set_background → render_frames again → export_video (mp4). Report the output path.',
      },
    }],
  }))

  const transport = new StdioServerTransport()
  await mcp.connect(transport)
  const shutdown = async () => {
    await embedded?.close()
    process.exit(0)
  }
  process.stdin.on('close', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

export type { UnicaliClient }
