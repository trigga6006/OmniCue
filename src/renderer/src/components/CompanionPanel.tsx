import { memo, useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { MessageSquarePlus, X, ChevronUp } from 'lucide-react'
import { glassCompanionStyle } from '@/lib/glass'
import { useCompanionStore } from '@/stores/companionStore'
import { CompanionMessage } from './CompanionMessage'
import { CompanionInput } from './CompanionInput'
import { ScreenshotChip } from './ScreenshotChip'
import oiLogo from '@/assets/oi-logo.svg'
import { ScreenshotLightbox } from './ScreenshotLightbox'
import { ModelPicker } from './ModelPicker'
import { QuickActions } from './QuickActions'
import { PANEL_SIZES, type PanelSizeMode } from '@/lib/constants'
import { resolvePanelSize } from '@/lib/resolvePanelSize'
import { Minimize2 } from 'lucide-react'

interface CompanionPanelProps {
  visible: boolean
  onClose: () => void
  anchorX: number
  anchorY: number
}

const transition = { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const }

export const CompanionPanel = memo(function CompanionPanel({
  visible,
  onClose,
  anchorX: _anchorX,
  anchorY,
}: CompanionPanelProps) {
  const messages = useCompanionStore((s) => s.messages)
  const isStreaming = useCompanionStore((s) => s.isStreaming)
  const streamingMessageId = useCompanionStore((s) => s.streamingMessageId)
  const pendingScreenshot = useCompanionStore((s) => s.pendingScreenshot)
  const sessionId = useCompanionStore((s) => s.sessionId)
  const newSession = useCompanionStore((s) => s.newSession)
  const panelSizeMode = useCompanionStore((s) => s.panelSizeMode)
  const sizeConfig = PANEL_SIZES[panelSizeMode]
  const setPendingScreenshot = useCompanionStore((s) => s.setPendingScreenshot)
  const viewHorizon = useCompanionStore((s) => s.viewHorizon)
  const showingAll = useCompanionStore((s) => s.showingAll)
  const showAll = useCompanionStore((s) => s.showAll)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedScreenshot, setExpandedScreenshot] = useState<{
    image: string
    title: string
  } | null>(null)

  const hasEarlier = viewHorizon > 0 && messages.length > viewHorizon
  const visibleMessages = useMemo(() => {
    if (showingAll || viewHorizon === 0) return messages
    return messages.slice(viewHorizon)
  }, [messages, viewHorizon, showingAll])

  const openScreenshot = useCallback((image: string, title: string) => {
    setExpandedScreenshot({ image, title })
  }, [])

  // Wire up AI stream listeners
  useEffect(() => {
    if (!visible) return

    const store = useCompanionStore.getState

    const unsubToken = window.electronAPI.onAiStreamToken((data) => {
      if (data.sessionId === store().sessionId) {
        store().appendToken(data.token)
      }
    })

    const unsubDone = window.electronAPI.onAiStreamDone((data) => {
      if (data.sessionId === store().sessionId) {
        store().finishStreaming(data.fullText)
        // Heuristic resize based on response content
        const newSize = resolvePanelSize(data.fullText)
        if (newSize !== store().panelSizeMode) {
          store().setPanelSizeMode(newSize)
        }
      }
    })

    const unsubError = window.electronAPI.onAiStreamError((data) => {
      if (data.sessionId === store().sessionId) {
        store().streamError(data.error)
      }
    })

    const unsubTool = window.electronAPI.onAiToolUse((data) => {
      if (data.sessionId === store().sessionId) {
        store().addToolUse(data.toolName, data.toolInput)
      }
    })

    return () => {
      unsubToken()
      unsubDone()
      unsubError()
      unsubTool()
    }
  }, [visible, sessionId])

  useEffect(() => {
    if (!visible) {
      setExpandedScreenshot(null)
    } else {
      // Hydrate persisted model mode on open
      window.electronAPI.getSettings().then((s) => {
        if (s.aiMode) useCompanionStore.getState().setAiMode(s.aiMode)
      })
    }
  }, [visible])

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  return (
    <>
      <AnimatePresence>
        {visible && !expandedScreenshot && (
          <motion.div
            className="fixed z-50 flex flex-col
              backdrop-blur-3xl backdrop-saturate-[1.6]
              bg-[rgba(14,14,18,0.93)] border-[0.5px] border-[rgba(255,255,255,0.12)]
              rounded-2xl overflow-hidden"
            style={{
              ...glassCompanionStyle,
              top: anchorY + 56,
              left: '50%',
              transform: 'translateX(-50%)',
            }}
            initial={{ y: -16, opacity: 0, scale: 0.96, width: sizeConfig.panelW, maxHeight: sizeConfig.panelMaxH + 140 }}
            animate={{ y: 0, opacity: 1, scale: 1, width: sizeConfig.panelW, maxHeight: sizeConfig.panelMaxH + 140 }}
            exit={{ y: -16, opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            data-interactive
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--g-line)]">
              <div className="flex items-center gap-1.5">
                <img src={oiLogo} alt="" className="w-4 h-4" />
                <span className="text-[13px] font-medium text-[var(--g-text-bright)]">
                  OmniCue
                </span>
              </div>
              <ModelPicker />
              <div className="flex items-center gap-1">
                {panelSizeMode !== 'compact' && (
                  <button
                    onClick={() => useCompanionStore.getState().setPanelSizeMode('compact')}
                    className="w-6 h-6 flex items-center justify-center rounded-md
                      text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]
                      transition-colors cursor-pointer"
                    title="Collapse panel"
                  >
                    <Minimize2 size={14} />
                  </button>
                )}
                <button
                  onClick={newSession}
                  className="w-6 h-6 flex items-center justify-center rounded-md
                    text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]
                    transition-colors cursor-pointer"
                  title="New session"
                >
                  <MessageSquarePlus size={14} />
                </button>
                <button
                  onClick={onClose}
                  className="w-6 h-6 flex items-center justify-center rounded-md
                    text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]
                    transition-colors cursor-pointer"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <motion.div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-3 py-3 min-h-[120px]"
              animate={{ maxHeight: sizeConfig.panelMaxH }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            >
              {visibleMessages.length === 0 && !hasEarlier ? (
                <QuickActions />
              ) : (
                <>
                  {hasEarlier && !showingAll && (
                    <button
                      onClick={showAll}
                      className="flex items-center gap-1.5 mx-auto mb-3 px-3 py-1.5 rounded-lg
                        text-[11px] text-[var(--g-text-secondary)]
                        hover:text-[var(--g-text)] hover:bg-[var(--g-bg-hover)]
                        transition-colors cursor-pointer"
                    >
                      <ChevronUp size={12} />
                      Load earlier messages
                    </button>
                  )}
                  {visibleMessages.map((msg) => (
                    <CompanionMessage
                      key={msg.id}
                      message={msg}
                      isStreaming={isStreaming && msg.id === streamingMessageId}
                      onOpenScreenshot={openScreenshot}
                    />
                  ))}
                </>
              )}
            </motion.div>

            {/* Screenshot chip */}
            {pendingScreenshot && (
              <div className="px-3 pb-1">
                <ScreenshotChip
                  image={pendingScreenshot.image}
                  title={pendingScreenshot.title}
                  onRemove={() => setPendingScreenshot(null)}
                  onOpen={() => openScreenshot(pendingScreenshot.image, pendingScreenshot.title)}
                />
              </div>
            )}

            {/* Input */}
            <div className="border-t border-[var(--g-line)]">
              <CompanionInput onClose={onClose} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ScreenshotLightbox
        image={expandedScreenshot?.image || null}
        title={expandedScreenshot?.title || 'Screenshot'}
        onClose={() => setExpandedScreenshot(null)}
      />
    </>
  )
})
