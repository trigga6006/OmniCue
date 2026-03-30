import { useCallback } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import chimeUrl from '@/assets/sounds/chime.wav'

// Module-level Web Audio context and decoded buffer (shared across all hook instances)
let audioCtx: AudioContext | null = null
let buffer: AudioBuffer | null = null
let loading: Promise<AudioBuffer | null> | null = null

async function ensureBuffer(): Promise<AudioBuffer | null> {
  if (buffer) return buffer
  if (loading) return loading

  loading = (async () => {
    try {
      audioCtx = audioCtx || new AudioContext()
      const res = await fetch(chimeUrl)
      if (!res.ok) throw new Error(`fetch ${res.status}: ${res.statusText}`)
      const ab = await res.arrayBuffer()
      buffer = await audioCtx.decodeAudioData(ab)
      console.log('[Sound] chime loaded OK')
      return buffer
    } catch (e) {
      console.error('[Sound] failed to load chime:', e, '| url:', chimeUrl)
      loading = null
      return null
    }
  })()

  return loading
}

// Start loading immediately on module init
ensureBuffer()

export function useSound() {
  const play = useCallback(async () => {
    const { soundEnabled, soundVolume } = useSettingsStore.getState().settings
    if (!soundEnabled) return

    try {
      const buf = await ensureBuffer()
      if (!audioCtx || !buf) return

      // Resume context if it was suspended (browser autoplay policy)
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }

      const source = audioCtx.createBufferSource()
      const gain = audioCtx.createGain()
      source.buffer = buf
      gain.gain.value = soundVolume
      source.connect(gain).connect(audioCtx.destination)
      source.start()
    } catch (e) {
      console.error('[Sound] play failed:', e)
    }
  }, [])

  return { play }
}
