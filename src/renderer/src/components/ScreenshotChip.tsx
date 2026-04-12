import { memo } from 'react'
import { X } from 'lucide-react'

interface ScreenshotChipProps {
  image: string
  title: string
  onRemove: () => void
  onOpen: () => void
}

export const ScreenshotChip = memo(function ScreenshotChip({
  image,
  title,
  onRemove,
  onOpen,
}: ScreenshotChipProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--g-bg-active)] border-[0.5px] border-[var(--g-line)]">
      <button
        onClick={onOpen}
        className="rounded overflow-hidden shrink-0 cursor-pointer outline-none
          ring-0 hover:opacity-90 transition-opacity"
        title="Open screenshot"
      >
        <img
          src={image}
          alt={title}
          className="w-20 h-[52px] object-cover"
        />
      </button>
      <span className="text-[11px] text-[var(--g-text-secondary)] max-w-[120px] truncate">
        {title}
      </span>
      <button
        onClick={onRemove}
        className="w-5 h-5 flex items-center justify-center rounded-full
          hover:bg-[var(--g-bg-active)] text-[var(--g-text-secondary)] hover:text-[var(--g-text-bright)]
          transition-colors cursor-pointer"
      >
        <X size={12} />
      </button>
    </div>
  )
})
