import { useState, useEffect } from 'react'

export function useCountdown(totalSeconds: number, startedAt: number) {
  const [remaining, setRemaining] = useState(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000)
    return Math.max(0, totalSeconds - elapsed)
  })

  useEffect(() => {
    const calc = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      return Math.max(0, totalSeconds - elapsed)
    }

    setRemaining(calc())

    const interval = setInterval(() => {
      const r = calc()
      setRemaining(r)
      if (r <= 0) clearInterval(interval)
    }, 1000)

    return () => clearInterval(interval)
  }, [totalSeconds, startedAt])

  const progress = totalSeconds > 0 ? remaining / totalSeconds : 0

  return { remaining, progress }
}
