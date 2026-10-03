#!/usr/bin/env node
// Launcher: runs the TypeScript CLI through tsx so there is no separate build step.
import { register } from 'tsx/esm/api'

register()
await import('../server/cli.ts')
