import { motion, AnimatePresence } from 'motion/react'
import { X, Trash2, Clock, ArrowUpRight, Timer, Bell, Repeat } from 'lucide-react'
import { useHistoryStore } from '@/stores/historyStore'
import { formatTime, timeAgo } from '@/lib/utils'
import { glassPanelStyle } from '@/lib/glass'
import type { EntryType } from '@/lib/types'
import claudeLogo from '@/assets/claude-logo.svg'
import codexLogo from '@/assets/codex-logo.svg'

function TypeIcon({ type }: { type?: EntryType }) {
  switch (type) {
    case 'alarm':
      return <Bell size={9} className="text-amber-400/70 shrink-0" strokeWidth={2} />
    case 'reminder':
      return <Repeat size={9} className="text-sky-400/70 shrink-0" strokeWidth={2} />
    case 'claude':
      return <img src={claudeLogo} alt="Claude" className="shrink-0" style={{ width: 9, height: 9 }} />
    case 'codex':
      return <img src={codexLogo} alt="Codex" className="shrink-0" style={{ width: 9, height: 9 }} />
    default:
      return <Timer size={9} className="text-[var(--g-text-muted)] shrink-0" strokeWidth={2} />
  }
}

function entrySubtitle(entry: ReturnType<typeof useHistoryStore.getState>['entries'][0]): string {
  if (entry.type === 'alarm') return 'alarm'
  if (entry.type === 'reminder') return 'reminder'
  if (entry.type === 'claude') return 'Claude Code'
  if (entry.type === 'codex') return 'Codex'
  return formatTime(entry.duration)
}

export function HistoryPanel({ visible, onClose, anchorX, anchorY }: { visible: boolean; onClose: () => void; anchorX: number; anchorY: number }) {
  const { entries, clear } = useHistoryStore()

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            className="fixed z-50 w-[260px] max-h-[320px] rounded-2xl backdrop-blur-2xl backdrop-saturate-[1.8]
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
                  History
                </span>
                <button
                  onClick={() => { window.electronAPI.openSettingsWindow('history'); onClose() }}
                  className="p-0.5 rounded hover:bg-[var(--g-bg)] text-[var(--g-text-faint)] hover:text-[var(--g-text-secondary)]
                    transition-colors duration-150 cursor-pointer outline-none"
                >
                  <ArrowUpRight size={10} strokeWidth={2} />
                </button>
              </div>
              <div className="flex items-center gap-1">
                {entries.length > 0 && (
                  <button
                    onClick={clear}
                    className="p-1 rounded-md hover:bg-[var(--g-bg)] text-[var(--g-text-muted)] hover:text-[var(--g-text-secondary)]
                      transition-colors duration-150 cursor-pointer outline-none"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-1 rounded-md hover:bg-[var(--g-bg)] text-[var(--g-text-muted)] hover:text-[var(--g-text-secondary)]
                    transition-colors duration-150 cursor-pointer outline-none"
                >
                  <X size={11} />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto max-h-[260px] py-0.5 scrollbar-none">
              {entries.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Clock size={16} className="mx-auto mb-2 text-[var(--g-text-faint)]" />
                  <span className="text-[11px] text-[var(--g-text-faint)]">No history yet</span>
                </div>
              ) : (
                entries.map((entry, i) => (
                  <motion.div
                    key={entry.id}
                    className="flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--g-bg-subtle)]
                      transition-colors duration-100"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.025, duration: 0.2 }}
                  >
                    <TypeIcon type={entry.type} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-[var(--g-text)] truncate leading-tight">
                        {entry.name}
                      </div>
                      <div className="text-[10px] text-[var(--g-text-muted)] leading-tight">
                        {entrySubtitle(entry)} &middot; {timeAgo(entry.completedAt)}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
