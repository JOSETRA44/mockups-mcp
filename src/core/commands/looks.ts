import { z } from 'zod'
import { getDevice } from '../devices/registry'
import { LOOKS, lookFromPalette } from '../looks'
import { CommandError, defineCommand, edit } from './types'

export const applyLook = defineCommand({
  name: 'apply_look',
  summary: 'Apply a look (background + lighting + device finish)',
  description:
    `One-click moods: ${LOOKS.map((l) => l.id).join(', ')}, or "match-media" to derive the background from the screenshot's colours. ` +
    'Fine-tune afterwards with set_background / set_lighting / set_device.',
  args: z.object({
    look: z.string().describe(`One of: ${[...LOOKS.map((l) => l.id), 'match-media'].join(', ')}`),
    keepFinish: z.boolean().default(false).describe('Do not change device colours'),
  }),
  run: (p, a) => {
    let look = LOOKS.find((l) => l.id === a.look) ?? null
    if (a.look === 'match-media') {
      const screenAsset = p.nodes.flatMap((n) => (n.type === 'device' && n.screen.assetId ? [p.assets[n.screen.assetId]] : []))[0]
      look = lookFromPalette(screenAsset?.palette ?? [])
      if (!look) throw new CommandError('CONFLICT', 'No palette available: put an image or video on a device screen first.')
    }
    if (!look) throw new CommandError('INVALID_ARGS', `Unknown look "${a.look}". Options: ${[...LOOKS.map((l) => l.id), 'match-media'].join(', ')}`)
    const chosen = look
    return edit(p, (d) => {
      d.settings.background = { ...chosen.background }
      d.settings.lighting = { ...chosen.lighting }
      if (!a.keepFinish) {
        for (const n of d.nodes) {
          if (n.type !== 'device') continue
          const finish = getDevice(n.deviceId).finishes.find((f) => chosen.finishes.includes(f.id))
          if (finish) n.finishId = finish.id
        }
      }
    })
  },
})
