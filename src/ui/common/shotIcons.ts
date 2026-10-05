import { Focus, Orbit, RotateCcw, Scan, Smartphone, type LucideIcon } from 'lucide-react'
import type { ShotKind } from '@/core/schema/project'

export const SHOT_ICONS: Record<ShotKind, LucideIcon> = { hero: Smartphone, focus: Focus, angle: RotateCcw, wide: Scan, orbit: Orbit }
