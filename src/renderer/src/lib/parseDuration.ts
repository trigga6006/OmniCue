export function parseDuration(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // "5:00" or "1:30" format (m:ss)
  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})$/)
  if (colonMatch) {
    const minutes = parseInt(colonMatch[1], 10)
    const seconds = parseInt(colonMatch[2], 10)
    if (seconds >= 60) return null
    const total = minutes * 60 + seconds
    return total > 0 ? total : null
  }

  // "5m", "5min" format
  const minMatch = trimmed.match(/^(\d+)\s*m(?:in)?$/i)
  if (minMatch) {
    const total = parseInt(minMatch[1], 10) * 60
    return total > 0 ? total : null
  }

  // "90s", "90sec" format
  const secMatch = trimmed.match(/^(\d+)\s*s(?:ec)?$/i)
  if (secMatch) {
    const total = parseInt(secMatch[1], 10)
    return total > 0 ? total : null
  }

  // "5h", "5hr" format
  const hourMatch = trimmed.match(/^(\d+)\s*h(?:r)?$/i)
  if (hourMatch) {
    const total = parseInt(hourMatch[1], 10) * 3600
    return total > 0 ? total : null
  }

  // Plain number — treat as minutes
  const plainNum = trimmed.match(/^(\d+)$/)
  if (plainNum) {
    const total = parseInt(plainNum[1], 10) * 60
    return total > 0 ? total : null
  }

  return null
}
