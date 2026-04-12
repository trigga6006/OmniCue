import { useState, useCallback, useRef } from 'react'
import type { ResumeCapsule } from '@/lib/types'

interface LiveContext {
  activeApp: string
  processName: string
  windowTitle: string
}

interface MemoryPreviewState {
  capsule: ResumeCapsule | null
  liveContext: LiveContext | null
  loading: boolean
}

/**
 * Hook for lazy-loading memory preview data.
 * Caches capsules by conversationId for the current list session.
 * Fetches live desktop context once and reuses it.
 */
export function useMemoryPreview() {
  const capsuleCache = useRef(new Map<string, ResumeCapsule | null>())
  const [liveContext, setLiveContext] = useState<LiveContext | null>(null)
  const liveContextFetched = useRef(false)

  const fetchPreview = useCallback(
    async (conversationId: string): Promise<MemoryPreviewState> => {
      // Check cache first
      if (capsuleCache.current.has(conversationId)) {
        return {
          capsule: capsuleCache.current.get(conversationId) ?? null,
          liveContext,
          loading: false,
        }
      }

      // Fetch capsule
      const capsule = await window.electronAPI.sessionMemoryGetCapsule(conversationId)
      capsuleCache.current.set(conversationId, capsule)

      // Fetch live context once
      if (!liveContextFetched.current) {
        try {
          const ctx = await window.electronAPI.desktopGetLiveContext()
          setLiveContext(ctx)
          liveContextFetched.current = true
          return { capsule, liveContext: ctx, loading: false }
        } catch {
          liveContextFetched.current = true
          return { capsule, liveContext: null, loading: false }
        }
      }

      return { capsule, liveContext, loading: false }
    },
    [liveContext]
  )

  const clearMemory = useCallback(async (conversationId: string) => {
    await window.electronAPI.sessionMemoryClear(conversationId)
    capsuleCache.current.delete(conversationId)
  }, [])

  const invalidateCache = useCallback((conversationId: string) => {
    capsuleCache.current.delete(conversationId)
  }, [])

  return { fetchPreview, clearMemory, invalidateCache }
}
