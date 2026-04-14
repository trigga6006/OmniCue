import { memo } from 'react'
import { Monitor, MessageSquare, Clock, Trash2, Pin } from 'lucide-react'
import type { ResumeCapsule } from '@/lib/types'

interface MemoryPreviewCardProps {
  capsule: ResumeCapsule
  isCurrentConversation: boolean
  liveContext?: { activeApp: string; processName: string; windowTitle: string } | null
  onClear: () => void
  onPin?: () => void
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\u2026' : s
}

function timeAgoShort(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

export const MemoryPreviewCard = memo(function MemoryPreviewCard({
  capsule,
  isCurrentConversation,
  onClear,
  onPin
}: MemoryPreviewCardProps) {
  return (
    <div
      className="bg-[rgba(20,20,25,0.95)] border border-[rgba(255,255,255,0.12)]
        rounded-lg p-3 shadow-xl backdrop-blur-sm min-w-[240px] max-w-[320px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Desktop context */}
      {capsule.summary && (
        <div className="flex items-start gap-2 mb-2">
          <Monitor size={12} className="text-[var(--g-text-secondary)] mt-0.5 shrink-0" />
          <span className="text-[11px] text-[var(--g-text-bright)] leading-tight">
            {truncate(capsule.summary, 80)}
          </span>
        </div>
      )}

      {/* Last user message */}
      {capsule.lastUserMessage && (
        <div className="flex items-start gap-2 mb-2">
          <MessageSquare size={12} className="text-[var(--g-text-secondary)] mt-0.5 shrink-0" />
          <span className="text-[11px] text-[var(--g-text-secondary)] leading-tight italic">
            &ldquo;{truncate(capsule.lastUserMessage, 80)}&rdquo;
          </span>
        </div>
      )}

      {/* Pending state */}
      {(capsule.pending?.waitingOn || capsule.lastAssistantAction) && (
        <div className="flex items-start gap-2 mb-2">
          <Clock size={12} className="text-amber-400/70 mt-0.5 shrink-0" />
          <span className="text-[11px] text-amber-400/70 leading-tight">
            {truncate(capsule.pending?.waitingOn || capsule.lastAssistantAction || '', 80)}
          </span>
        </div>
      )}

      {/* Tags */}
      {capsule.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {capsule.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-[9px] bg-[rgba(255,255,255,0.06)]
                text-[var(--g-text-secondary)] leading-none"
            >
              {tag}
            </span>
          ))}
          {capsule.tags.length > 4 && (
            <span className="text-[9px] text-[var(--g-text-secondary)] leading-none py-0.5">
              +{capsule.tags.length - 4} more
            </span>
          )}
        </div>
      )}

      {/* Capsule age */}
      <div className="text-[9px] text-[var(--g-text-secondary)] mb-2 opacity-60">
        Saved {timeAgoShort(capsule.updatedAt)}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 pt-1 border-t border-[rgba(255,255,255,0.06)]">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
          className="flex items-center gap-1 text-[10px] text-[var(--g-text-secondary)]
            hover:text-red-400 transition-colors cursor-pointer"
        >
          <Trash2 size={10} />
          Clear memory
        </button>
        {isCurrentConversation && onPin && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPin()
            }}
            className="flex items-center gap-1 text-[10px] text-[var(--g-text-secondary)]
              hover:text-blue-400 transition-colors cursor-pointer ml-auto"
          >
            <Pin size={10} />
            Save memory
          </button>
        )}
      </div>
    </div>
  )
})
