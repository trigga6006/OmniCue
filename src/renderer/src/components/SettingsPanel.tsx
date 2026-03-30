import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { parseDuration } from '@/lib/parseDuration'
import { formatTime } from '@/lib/utils'
import { glassPanelStyle } from '@/lib/glass'

function GlassToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-200 cursor-pointer
        border-[0.5px] outline-none
        ${checked ? 'bg-[#34C759]/65 border-[#34C759]/30' : 'bg-[var(--g-bg)] border-[var(--g-line-subtle)]'}`}
      onClick={() => onChange(!checked)}
    >
      <motion.div
        className="absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.25), 0 0 0 0.5px rgba(0,0,0,0.04)' }}
        animate={{ left: checked ? 19 : 3 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  )
}

export function SettingsPanel({ visible, onClose, anchorX, anchorY }: { visible: boolean; onClose: () => void; anchorX: number; anchorY: number }) {
  const { settings, update } = useSettingsStore()
  const [durationInput, setDurationInput] = useState(formatTime(settings.defaultDuration))
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null)

  useEffect(() => {
    if (visible && claudeInstalled === null) {
      window.electronAPI.checkClaudeIntegration().then(setClaudeInstalled)
    }
  }, [visible])

  const handleDurationBlur = () => {
    const seconds = parseDuration(durationInput)
    if (seconds && seconds > 0) {
      update({ defaultDuration: seconds })
    } else {
      setDurationInput(formatTime(settings.defaultDuration))
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            className="fixed z-50 w-[220px] rounded-2xl backdrop-blur-2xl backdrop-saturate-[1.8]
              bg-[var(--g-bg)] border-[0.5px] border-[var(--g-line)] overflow-hidden pointer-events-auto"
            style={{ top: anchorY + 24, left: anchorX, ...glassPanelStyle }}
            initial={{ y: -16, opacity: 0, scale: 0.96, x: '-50%' }}
            animate={{ y: 0, opacity: 1, scale: 1, x: '-50%' }}
            exit={{ y: -16, opacity: 0, scale: 0.96, x: '-50%' }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            data-interactive
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--g-line-faint)]">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium text-[var(--g-text)] tracking-[-0.01em]">
                  Settings
                </span>
                <button
                  onClick={() => { window.electronAPI.openSettingsWindow('settings'); onClose() }}
                  className="p-0.5 rounded hover:bg-[var(--g-bg)] text-[var(--g-text-faint)] hover:text-[var(--g-text-secondary)]
                    transition-colors duration-150 cursor-pointer outline-none"
                >
                  <ArrowUpRight size={10} strokeWidth={2} />
                </button>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-[var(--g-bg)] text-[var(--g-text-muted)] hover:text-[var(--g-text-secondary)]
                  transition-colors duration-150 cursor-pointer outline-none"
              >
                <X size={11} />
              </button>
            </div>

            {/* Settings rows */}
            <div className="px-4 py-3 space-y-3">
              {/* Default duration */}
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[var(--g-text-secondary)]">Default time</span>
                <input
                  type="text"
                  value={durationInput}
                  onChange={(e) => setDurationInput(e.target.value)}
                  onBlur={handleDurationBlur}
                  onKeyDown={(e) => e.key === 'Enter' && handleDurationBlur()}
                  className="w-14 text-right bg-[var(--g-bg-subtle)] rounded-lg px-2 py-[3px]
                    text-[12px] text-[var(--g-text)] border-[0.5px] border-[var(--g-line-subtle)] outline-none
                    focus:border-[var(--g-line-focus)] transition-colors duration-150"
                />
              </div>

              {/* Sound */}
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[var(--g-text-secondary)]">Sound</span>
                <GlassToggle
                  checked={settings.soundEnabled}
                  onChange={(v) => update({ soundEnabled: v })}
                />
              </div>

              {/* Volume */}
              <AnimatePresence>
                {settings.soundEnabled && (
                  <motion.div
                    className="flex items-center justify-between"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <span className="text-[12px] text-[var(--g-text-secondary)]">Volume</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={settings.soundVolume}
                      onChange={(e) => update({ soundVolume: parseFloat(e.target.value) })}
                      className="w-20 h-[3px] rounded-full appearance-none bg-[var(--g-bg)] cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none
                        [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--g-slider-thumb)]"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Separator */}
              <div className="h-px bg-[var(--g-line-faint)]" />

              {/* Auto-launch */}
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[var(--g-text-secondary)]">Start on boot</span>
                <GlassToggle
                  checked={settings.autoLaunch}
                  onChange={(v) => update({ autoLaunch: v })}
                />
              </div>

              {/* Theme */}
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[var(--g-text-secondary)]">Dark mode</span>
                <GlassToggle
                  checked={settings.theme === 'dark'}
                  onChange={(v) => update({ theme: v ? 'dark' : 'light' })}
                />
              </div>

              {/* Separator */}
              <div className="h-px bg-[var(--g-line-faint)]" />

              {/* Claude Code integration */}
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[var(--g-text-secondary)]">Claude Code</span>
                {claudeInstalled === null ? (
                  <span className="text-[11px] text-[var(--g-text-faint)]">...</span>
                ) : claudeInstalled ? (
                  <div className="flex items-center gap-1">
                    <CheckCircle2 size={11} className="text-emerald-400/70" strokeWidth={2} />
                    <span className="text-[11px] text-emerald-400/60">Active</span>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      const result = await window.electronAPI.installClaudeIntegration()
                      if (result.ok) setClaudeInstalled(true)
                    }}
                    className="text-[11px] text-[var(--g-text-muted)] hover:text-[var(--g-text)]
                      underline underline-offset-2 cursor-pointer transition-colors outline-none"
                  >
                    Install
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
