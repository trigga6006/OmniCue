import { useEffect } from 'react'

/**
 * Forces dark mode on mount. Light mode is disabled — the overlay
 * always uses the dark glass theme regardless of background brightness.
 */
export function useBrightnessSampler(): void {
  useEffect(() => {
    document.documentElement.setAttribute('data-bg', 'dark')
  }, [])
}
