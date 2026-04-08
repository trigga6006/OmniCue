export const GLASS = {
  base: 'backdrop-blur-2xl border border-white/18 shadow-[0_8px_32px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.15)]',
  dark: 'bg-white/12 text-white/90',
  light: 'bg-white/45 text-black/80',
  hover: 'hover:bg-white/20 hover:border-white/30',
  hoverLight: 'hover:bg-white/55 hover:border-white/40',
} as const

export const DEFAULT_SETTINGS = {
  defaultDuration: 300,
  soundEnabled: true,
  soundVolume: 0.7,
  autoLaunch: false,
  theme: 'dark' as const,
}

export const TIMER_CIRCLE_SIZE = 48
export const PLUS_BUTTON_SIZE = 36
export const COMPANION_HEIGHT = 600
