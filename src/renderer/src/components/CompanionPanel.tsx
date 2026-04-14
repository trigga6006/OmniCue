import { memo, useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  MessageSquarePlus,
  X,
  ChevronUp,
  Maximize2,
  Minimize2,
  Maximize,
  Minimize,
  History,
  FileText,
  Pin
} from 'lucide-react'
import { glassCompanionStyle, glassMenuStyle } from '@/lib/glass'
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
  anchorY
}: CompanionPanelProps) {
  const messages = useCompanionStore((s) => s.messages)
  const isStreaming = useCompanionStore((s) => s.isStreaming)
  const streamingMessageId = useCompanionStore((s) => s.streamingMessageId)
  const pendingScreenshot = useCompanionStore((s) => s.pendingScreenshot)
  const conversationId = useCompanionStore((s) => s.conversationId)
  const pinnedConversationId = useCompanionStore((s) => s.pinnedConversationId)
  const toggleConversationPin = useCompanionStore((s) => s.toggleConversationPin)
  const newSession = useCompanionStore((s) => s.newSession)
  const panelSizeMode = useCompanionStore((s) => s.panelSizeMode)
  const isFullscreen = panelSizeMode === 'fullscreen'
  // In fullscreen mode the panel fills the window — sizeConfig is only used for standard modes
  const sizeConfig = isFullscreen ? null : PANEL_SIZES[panelSizeMode as keyof typeof PANEL_SIZES]
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
  const isPinnedConversation = messages.length > 0 && pinnedConversationId === conversationId

  const hasEarlier = viewHorizon > 0 && messages.length > viewHorizon
  const visibleMessages = useMemo(() => {
    if (showingAll || viewHorizon === 0) return messages
    return messages.slice(viewHorizon)
  }, [messages, viewHorizon, showingAll])

  const openScreenshot = useCallback((image: string, title: string) => {
    setExpandedScreenshot({ image, title })
  }, [])

  // ── Right-click context menu for fullscreen toggle ─────────────────────
  const [sizeMenuPos, setSizeMenuPos] = useState<{ x: number; y: number } | null>(null)
  const sizeMenuLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSizeContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSizeMenuPos({ x: e.clientX, y: e.clientY })
  }, [])

  const handleSizeMenuMouseLeave = useCallback(() => {
    sizeMenuLeaveTimer.current = setTimeout(() => setSizeMenuPos(null), 300)
  }, [])

  const handleSizeMenuMouseEnter = useCallback(() => {
    if (sizeMenuLeaveTimer.current) clearTimeout(sizeMenuLeaveTimer.current)
  }, [])

  // AI stream listeners are registered globally in useAiStreamListeners (App.tsx)
  // so they persist regardless of panel visibility.

  useEffect(() => {
    if (!visible) {
      setExpandedScreenshot(null)
      setSizeMenuPos(null)
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
              ...(isFullscreen
                ? {
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                  }
                : {
                    top: anchorY + 56,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: sizeConfig!.panelW,
                    maxHeight: sizeConfig!.panelMaxH + 140,
                  }),
              willChange: 'transform, opacity',
              transition:
                'width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), max-height 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)'
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
                <span className="text-[13px] font-medium text-[var(--g-text-bright)]">OmniCue</span>
              </div>
              <ProviderBadge />
              <div className="flex items-center gap-1">
                <button
                  onClick={() => void toggleConversationPin()}
                  disabled={messages.length === 0}
                  className={`w-6 h-6 flex items-center justify-center rounded-md
                    transition-colors
                    ${
                      messages.length === 0
                        ? 'text-[var(--g-text-dim)] opacity-40 cursor-default'
                        : isPinnedConversation
                          ? 'text-white bg-[rgba(0,0,0,0.6)] ring-1 ring-[rgba(255,255,255,0.12)] cursor-pointer'
                          : 'text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)] cursor-pointer'
                    }`}
                  title={isPinnedConversation ? 'Unpin conversation' : 'Pin conversation'}
                >
                  <Pin size={14} fill={isPinnedConversation ? 'currentColor' : 'none'} />
                </button>
                {panelSizeMode !== 'large' && !isFullscreen && (
                  <button
                    onClick={() => useCompanionStore.getState().transitionPanelSize('large')}
                    onContextMenu={handleSizeContextMenu}
                    className="w-6 h-6 flex items-center justify-center rounded-md
                      text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]
                      transition-colors cursor-pointer"
                    title="Expand panel"
                  >
                    <Maximize2 size={14} />
                  </button>
                )}
                {(panelSizeMode !== 'compact' || isFullscreen) && (
                  <button
                    onClick={() =>
                      useCompanionStore
                        .getState()
                        .transitionPanelSize(isFullscreen ? 'large' : 'compact')
                    }
                    onContextMenu={handleSizeContextMenu}
                    className="w-6 h-6 flex items-center justify-center rounded-md
                      text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]
                      transition-colors cursor-pointer"
                    title={isFullscreen ? 'Exit full screen' : 'Collapse panel'}
                  >
                    <Minimize2 size={14} />
                  </button>
                )}
                <button
                  onClick={toggleConversationList}
                  className={`w-6 h-6 flex items-center justify-center rounded-md
                    transition-colors cursor-pointer
                    ${
                      showConversationList
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
                    ${
                      showNotesList
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
                maxHeight: isFullscreen ? undefined : sizeConfig!.panelMaxH,
                transition: 'max-height 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)'
              }}
            >
              {/* In fullscreen, center content in a readable column (like ChatGPT/Claude web) */}
              <div className={isFullscreen ? 'max-w-4xl w-full mx-auto' : ''}>
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
            </div>

            {/* Screenshot chip */}
            {pendingScreenshot && (
              <div className={`px-3 pb-1 ${isFullscreen ? 'max-w-4xl w-full mx-auto' : ''}`}>
                <ScreenshotChip
                  image={pendingScreenshot.image}
                  title={pendingScreenshot.title}
                  onRemove={() => setPendingScreenshot(null)}
                  onOpen={() => openScreenshot(pendingScreenshot.image, pendingScreenshot.title)}
                />
              </div>
            )}

            {/* Quick actions — show above input when no messages */}
            {visibleMessages.length === 0 &&
              !hasEarlier &&
              !showNotesList &&
              !showConversationList && (
                <div className={isFullscreen ? 'max-w-4xl w-full mx-auto' : ''}>
                  <QuickActions />
                </div>
              )}

            {/* Input */}
            <div className="border-t border-[var(--g-line)]">
              <div className={isFullscreen ? 'max-w-4xl w-full mx-auto' : ''}>
                <CompanionInput onClose={onClose} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Right-click context menu for fullscreen toggle */}
      <AnimatePresence>
        {sizeMenuPos && visible && (
          <motion.div
            className="fixed z-[60] min-w-[136px] p-1 rounded-[14px] backdrop-blur-2xl backdrop-saturate-[1.8]
              bg-[var(--g-bg-hover)] border-[0.5px] border-[var(--g-line)] pointer-events-auto"
            style={{
              left: Math.min(sizeMenuPos.x, window.innerWidth - 160),
              top: Math.min(sizeMenuPos.y, window.innerHeight - 60),
              transformOrigin: 'top left',
              ...glassMenuStyle
            }}
            data-interactive
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            onMouseLeave={handleSizeMenuMouseLeave}
            onMouseEnter={handleSizeMenuMouseEnter}
          >
            <button
              className="w-full flex items-center gap-2.5 px-3 py-[6px] rounded-[10px]
                text-[var(--g-text)] text-[13px] font-light tracking-[-0.01em]
                hover:bg-[var(--g-bg)] hover:text-[var(--g-text-bright)]
                transition-colors duration-150 cursor-pointer outline-none"
              onClick={() => {
                useCompanionStore
                  .getState()
                  .transitionPanelSize(isFullscreen ? 'compact' : 'fullscreen')
                setSizeMenuPos(null)
              }}
            >
              {isFullscreen ? (
                <>
                  <Minimize size={13} strokeWidth={1.8} />
                  Exit Full Screen
                </>
              ) : (
                <>
                  <Maximize size={13} strokeWidth={1.8} />
                  Full Screen
                </>
              )}
            </button>
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
