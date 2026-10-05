import { useTranslation } from 'react-i18next'
import { EASE_IDS } from '@/core/animation/easing'

/** Easing names describe a feel (Jitter-style), not a curve. */
export function useEaseOptions() {
  const { t } = useTranslation()
  return EASE_IDS.map((e) => ({ value: e, label: t(`eases.${e}`) }))
}
