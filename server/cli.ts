import { writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { APP_ROOT, loadConfig } from './config'
import { connect } from './client'

const HELP = `unicali — animated 3D device mockups (editor server, MCP server and CLI)

Usage: unicali <command> [options]

Server
  serve [--port N] [--dev]          Start the editor + API at http://127.0.0.1:5299
  mcp                               Run the MCP server on stdio (for Claude Code, Codex, ...)
  mcp-config                        Print MCP client configuration snippets

Projects (auto-start a server if none is running)
  projects                          List projects
  new [--name X] [--template T]     Create a project
  show <id> [--full]                Show a project summary (or full JSON)
  catalog                           Presets, devices, templates and command schemas
  exec <id> <command> [json]        Run one command, e.g. exec <id> set_camera '{"yaw":20}'
  batch <id> <steps.json>           Run [{command,args},...] atomically
  import <id> <file> [--device D]   Import a local screenshot / recording onto a screen
  undo <id> | redo <id>
  frames <id> --out sheet.png [--times 0,1.5,3] [--width 360]
  material <id> --out sheet.png      Review sheet of the project's stills and takes

Capture (material from a running app)
  capture targets                    Phones, emulators and bootable emulator images
  capture open [--app pkg] [--target id] [--install app.apk]
  capture look <sid> [--out screen.png]
  capture act <sid> '<step json>' [--out screen.png]
  capture still <sid> <projectId> --label "Grades"
  capture take <sid> <projectId> <take.json>
  capture close <sid>
  export <id> [--format mp4|webm|png] [--scale 1] [--fps 30] [--quality high]
              [--motion-blur 1] [--out /abs/path.mp4] [--overwrite]

Environment: UNICALI_HOME (workspace, default ~/UnicaliMockups), UNICALI_PORT (5299),
             UNICALI_CHROME (Chrome/Chromium executable for headless rendering)
`

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { values: o, positionals: pos } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      port: { type: 'string' }, dev: { type: 'boolean' }, name: { type: 'string' }, template: { type: 'string' },
      full: { type: 'boolean' }, device: { type: 'string' }, app: { type: 'string' }, target: { type: 'string' },
      install: { type: 'string' }, label: { type: 'string' }, out: { type: 'string' }, times: { type: 'string' },
      width: { type: 'string' }, format: { type: 'string' }, scale: { type: 'string' }, fps: { type: 'string' },
      quality: { type: 'string' }, 'motion-blur': { type: 'string' }, overwrite: { type: 'boolean' },
    },
  })
  const print = (v: unknown) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return print(HELP)

  if (cmd === 'serve') {
    const { startServer } = await import('./http')
    const server = await startServer(loadConfig({ port: o.port ? Number(o.port) : undefined, dev: o.dev || undefined }))
    console.log(`Unicali running at ${server.url}  (workspace: ${server.workspace.home})`)
    const stop = async () => { await server.close(); process.exit(0) }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    return
  }
  if (cmd === 'mcp') {
    const { runMcpServer } = await import('./mcp')
    return runMcpServer()
  }
  if (cmd === 'mcp-config') {
    const entry = resolve(APP_ROOT, 'bin', 'unicali.mjs')
    return print({
      claudeCode: `claude mcp add unicali -- node "${entry}" mcp`,
      json: { mcpServers: { unicali: { command: 'node', args: [entry, 'mcp'] } } },
      codex: `[mcp_servers.unicali]\ncommand = "node"\nargs = ["${entry.replace(/\\/g, '\\\\')}", "mcp"]`,
    })
  }

  const { client, server } = await connect()
  const need = (i: number, what: string) => {
    if (!pos[i]) throw new Error(`Missing ${what}. Run "unicali help".`)
    return pos[i]
  }
  try {
    switch (cmd) {
      case 'projects': return print(await client.listProjects())
      case 'new': return print(await client.createProject(o.name, o.template).then((r) => ({ projectId: r.project.id, editor: `${client.base}/?project=${r.project.id}` })))
      case 'show': return print(o.full ? await client.getProject(need(0, 'project id')) : await client.describe(need(0, 'project id')))
      case 'catalog': return print(await client.catalog())
      case 'exec': return print(await client.exec(need(0, 'project id'), need(1, 'command'), pos[2] ? JSON.parse(pos[2]) : {}))
      case 'batch': return print(await client.batch(need(0, 'project id'), JSON.parse(readFileSync(need(1, 'steps file'), 'utf8'))))
      case 'import': return print(await client.importFile(need(0, 'project id'), resolve(need(1, 'file')), { deviceId: o.device }))
      case 'undo': return print(await client.undo(need(0, 'project id')))
      case 'redo': return print(await client.redo(need(0, 'project id')))
      case 'frames': {
        const out = resolve(o.out ?? 'frames.png')
        const png = await client.frames(need(0, 'project id'), {
          times: o.times ? o.times.split(',').map(Number) : undefined,
          width: o.width ? Number(o.width) : undefined,
        })
        await writeFile(out, png)
        return print({ saved: out, bytes: png.length })
      }
      case 'material': {
        const out = resolve(o.out ?? 'material.png')
        await writeFile(out, await client.material(need(0, 'project id')))
        return print({ saved: out })
      }
      case 'capture': {
        const sub = need(0, 'capture command')
        const saveLook = async (look: { png: string; elements: string[] } & Record<string, unknown>) => {
          const { png, ...rest } = look
          if (o.out) await writeFile(resolve(o.out), Buffer.from(png, 'base64'))
          return print({ ...rest, ...(o.out ? { screenshot: resolve(o.out) } : {}) })
        }
        switch (sub) {
          case 'targets': return print(await client.captureTargets())
          case 'open': return saveLook(await client.captureOpen({ kind: 'android', app: o.app, target: o.target, install: o.install ? resolve(o.install) : undefined }) as never)
          case 'look': return saveLook(await client.captureLook(need(1, 'session id')) as never)
          case 'act': return saveLook(await client.captureAct(need(1, 'session id'), JSON.parse(need(2, 'step json'))) as never)
          case 'still': return print(await client.captureStill(need(1, 'session id'), need(2, 'project id'), o.label ?? 'Screen'))
          case 'take': return print(await client.captureTake(need(1, 'session id'), need(2, 'project id'), JSON.parse(readFileSync(need(3, 'take json file'), 'utf8'))))
          case 'close': return print(await client.captureClose(need(1, 'session id')))
          default: throw new Error(`Unknown capture command "${sub}".`)
        }
      }
      case 'export':
        return print(await client.export(need(0, 'project id'), {
          format: (o.format as 'mp4' | 'webm' | 'png') ?? 'mp4',
          scale: o.scale ? Number(o.scale) : undefined,
          fps: o.fps ? Number(o.fps) : undefined,
          quality: o.quality as 'standard' | 'high' | 'max' | undefined,
          motionBlur: o['motion-blur'] ? Number(o['motion-blur']) : undefined,
          outputPath: o.out ? resolve(o.out) : undefined,
          overwrite: o.overwrite,
        }))
      default:
        throw new Error(`Unknown command "${cmd}". Run "unicali help".`)
    }
  } finally {
    await server?.close()
  }
}

main().catch((err) => {
  console.error(`unicali: ${(err as Error).message}`)
  process.exit(1)
})
