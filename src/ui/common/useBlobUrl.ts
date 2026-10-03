import { useEffect, useState } from 'react'
import { getBlob } from '@/media/assetStore'

/** Object URL for a stored asset, revoked on unmount. */
export function useBlobUrl(assetId: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!assetId) return setUrl(null)
    let alive = true
    let created: string | null = null
    void getBlob(assetId).then((blob) => {
      if (!alive || !blob) return
      created = URL.createObjectURL(blob)
      setUrl(created)
    })
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [assetId])
  return url
}
