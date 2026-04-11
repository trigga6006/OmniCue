import { memo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { glassPanelStyle } from '@/lib/glass'

interface ScreenshotLightboxProps {
  image: string | null
  title: string
  onClose: () => void
}

export const ScreenshotLightbox = memo(function ScreenshotLightbox({
  image,
  title,
  onClose,
}: ScreenshotLightboxProps) {
  return (
    <AnimatePresence>
      {image && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 pointer-events-auto
            backdrop-blur-2xl backdrop-saturate-[1.15]"
          style={{
            background: 'var(--g-overlay-strong)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          data-interactive
        >
          <motion.div
            className="relative w-full max-w-6xl"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="rounded-[28px] overflow-hidden border-[0.5px] border-[var(--g-line-subtle)]
                backdrop-blur-xl backdrop-saturate-[1.08]"
              style={{
                ...glassPanelStyle,
                background: 'var(--g-bg-strong)',
              }}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--g-line-subtle)]">
                <div className="text-[12px] text-[var(--g-text-secondary)] truncate pr-4">{title}</div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-full
                    backdrop-blur-xl backdrop-saturate-[1.1]
                    border border-[var(--g-line-subtle)]
                    text-[var(--g-text-secondary)] hover:text-[var(--g-text-bright)]
                    hover:bg-[var(--g-bg-hover)]
                    transition-colors cursor-pointer shrink-0"
                  style={{
                    background: 'color-mix(in srgb, var(--g-bg-strong) 86%, transparent)',
                  }}
                  title="Close screenshot"
                >
                  <X size={15} />
                </button>
              </div>

              <img
                src={image}
                alt={title || 'Screenshot'}
                className="block w-full max-h-[82vh] object-contain"
                style={{
                  background: 'var(--g-bg-strong)',
                }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
