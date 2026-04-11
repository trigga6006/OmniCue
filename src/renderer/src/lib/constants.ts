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
  barPosX: null,
  barPosY: null,
  theme: 'dark' as const,
  fullScreenAlarms: false,
  fullScreenReminders: false,
  fullScreenClaude: false,
  aiProvider: 'codex' as const,
  aiApiKey: '',
  aiBaseUrl: '',
  aiModel: '',
  aiMode: 'auto' as const,
  claudeApiKey: '',
  claudeModel: '',
  geminiApiKey: '',
  geminiModel: '',
  deepseekApiKey: '',
  deepseekModel: '',
  groqApiKey: '',
  groqModel: '',
  mistralApiKey: '',
  mistralModel: '',
  xaiApiKey: '',
  xaiModel: '',
  glmApiKey: '',
  glmModel: '',
  kimiApiKey: '',
  kimiModel: '',
  opencodeApiKey: '',
  opencodeModel: '',
  devRootPath: '',
  agentPermissions: 'read-only' as const,
  companionHotkey: 'Ctrl+Shift+Space',
}

export const TIMER_CIRCLE_SIZE = 48
export const PLUS_BUTTON_SIZE = 36
export const COMPANION_HEIGHT = 700

export const PANEL_SIZES = {
  compact: { panelMaxH: 440, panelW: 420, windowH: 700, windowW: 1000 },
  tall:    { panelMaxH: 640, panelW: 420, windowH: 900, windowW: 1000 },
  wide:    { panelMaxH: 440, panelW: 580, windowH: 700, windowW: 1400 },
  large:   { panelMaxH: 640, panelW: 580, windowH: 900, windowW: 1400 },
} as const

export type PanelSizeMode = keyof typeof PANEL_SIZES

// Morphing Pill dimensions
export const PILL_H = 36
export const PILL_PADDING = 4
export const PILL_ICON_SIZE = 28
export const PILL_DIVIDER_W = 9 // 1px line + 4px padding each side
export const PILL_TIMER_SLOT = 30
export const PILL_NOTIF_COLLAPSED = 36
export const PILL_NOTIF_EXPANDED = 260
