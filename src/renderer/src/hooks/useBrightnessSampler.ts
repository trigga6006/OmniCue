import { useEffect, useRef } from 'react'

const SAMPLE_INTERVAL = 15000 // ms between samples (reduced from 4s to avoid compositor stalls)
const LIGHT_THRESHOLD = 170  // switch to light mode above this
const DARK_THRESHOLD = 140   // switch back to dark mode below this (hysteresis)

/**
 * Periodically samples the screen brightness behind the overlay and sets
 * `data-bg="light"` or `data-bg="dark"` on <html>. Glass CSS tokens
 * in main.css react to this attribute automatically.
 */
export function useBrightnessSampler(): void {
  const modeRef = useRef<'light' | 'dark'>('dark')

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>

    const sample = async () => {
      try {
        const brightness = await window.electronAPI.sampleScreenBrightness()
        const current = modeRef.current

        // Hysteresis: require crossing the opposite threshold to switch
        if (current === 'dark' && brightness > LIGHT_THRESHOLD) {
          modeRef.current = 'light'
          document.documentElement.setAttribute('data-bg', 'light')
        } else if (current === 'light' && brightness < DARK_THRESHOLD) {
          modeRef.current = 'dark'
          document.documentElement.setAttribute('data-bg', 'dark')
        }
      } catch {
        // Sampling failed — keep current mode
      }
    }

    // Initial sample, then repeat
    sample()
    timer = setInterval(sample, SAMPLE_INTERVAL)

    return () => clearInterval(timer)
  }, [])
}
