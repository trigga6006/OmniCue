import { memo, useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { MessageSquarePlus, X, ChevronUp, Maximize2, Minimize2, History, FileText } from 'lucide-react'
import { glassCompanionStyle } from '@/lib/glass'
import { useCompanionStore } from '@/stores/companionStore'
import { CompanionMessage } from './CompanionMessage'
import { CompanionInput } from './CompanionInput'
import { ScreenshotChip } from './ScreenshotChip'
import oiLogo from '@/assets/oi-logo.svg'
import { ScreenshotLightbox } from './ScreenshotLightbox'
import { ProviderBadge } from './ProviderBadge'
import { QuickActions } from './QuickActions'
import { ConversationList } from './ConversationList'
import { NotesList } from './NotesList'
import { PANEL_SIZES } from '@/lib/constants'
import { releasePanelOpenTransition, releasePanelSizeTransition } from '@/stores/companionStore'

interface CompanionPanelProps {
  visible: boolean
  onClose: () => void
  anchorX: number
  anchorY: number
}

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
  const newSession = useCompanionStore((s) => s.newSession)
  const panelSizeMode = useCompanionStore((s) => s.panelSizeMode)
  const sizeConfig = PANEL_SIZES[panelSizeMode]
  const setPendingScreenshot = useCompanionStore((s) => s.setPendingScreenshot)
  const showConversationList = useCompanionStore((s) => s.showConversationList)
  const toggleConversationList = useCompanionStore((s) => s.toggleConversationList)
  const showNotesList = useCompanionStore((s) => s.showNotesList)
  const toggleNotesList = useCompanionStore((s) => s.toggleNotesList)
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

  // AI stream listeners are registered globally in useAiStreamListeners (App.tsx)
  // so they persist regardless of panel visibility.

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
            className="fixed z-50 flex flex-col pointer-events-auto
              backdrop-blur-3xl backdrop-saturate-[1.6]
              bg-[rgba(14,14,18,0.93)] border-[0.5px] border-[rgba(255,255,255,0.12)]
              rounded-2xl overflow-hidden"
            style={{
              ...glassCompanionStyle,
              top: anchorY + 56,
              left: '50%',
              transform: 'translateX(-50%)',
              width: sizeConfig.panelW,
              maxHeight: sizeConfig.panelMaxH + 140,
              willChange: 'transform, opacity',
              transition: 'width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), max-height 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
            }}
            initial={{ y: -16, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -16, opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            onAnimationComplete={() => {
              releasePanelOpenTransition()
              window.dispatchEvent(new Event('republish-interactive-regions'))
            }}
            onTransitionEnd={(e) => {
              // Only the outer shell's width transition should release size suppression.
              if (e.target !== e.currentTarget) return
              if (e.propertyName === 'width') {
                releasePanelSizeTransition()
              }
            }}
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
              <ProviderBadge />
              <div className="flex items-center gap-1">
                {panelSizeMode !== 'large' && (
                  <button
                    onClick={() => useCompanionStore.getState().transitionPanelSize('large')}
                    className="w-6 h-6 flex items-center justify-center rounded-md
                      text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]
                      transition-colors cursor-pointer"
                    title="Expand panel"
                  >
                    <Maximize2 size={14} />
                  </button>
                )}
                {panelSizeMode !== 'compact' && (
                  <button
                    onClick={() => useCompanionStore.getState().transitionPanelSize('compact')}
                    className="w-6 h-6 flex items-center justify-center rounded-md
                      text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]
                      transition-colors cursor-pointer"
                    title="Collapse panel"
                  >
                    <Minimize2 size={14} />
                  </button>
                )}
                <button
                  onClick={toggleConversationList}
                  className={`w-6 h-6 flex items-center justify-center rounded-md
                    transition-colors cursor-pointer
                    ${showConversationList
                      ? 'text-[var(--g-text-bright)] bg-[var(--g-bg-active)]'
                      : 'text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]'
                    }`}
                  title="Conversations"
                >
                  <History size={14} />
                </button>
                <button
                  onClick={toggleNotesList}
                  className={`w-6 h-6 flex items-center justify-center rounded-md
                    transition-colors cursor-pointer
                    ${showNotesList
                      ? 'text-[var(--g-text-bright)] bg-[var(--g-bg-active)]'
                      : 'text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]'
                    }`}
                  title="Notes"
                >
                  <FileText size={14} />
                </button>
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

            {/* Messages or Conversation List */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto min-h-[120px]"
              style={{
                maxHeight: sizeConfig.panelMaxH,
                transition: 'max-height 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
              }}
            >
              {showNotesList ? (
                <NotesList />
              ) : showConversationList ? (
                <ConversationList />
              ) : visibleMessages.length === 0 && !hasEarlier ? (
                <div className="flex-1 px-3 py-3" />
              ) : (
                <div className="px-3 py-3">
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
                </div>
              )}
            </div>

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

            {/* Quick actions — show above input when no messages */}
            {visibleMessages.length === 0 && !hasEarlier && !showNotesList && !showConversationList && <QuickActions />}

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
