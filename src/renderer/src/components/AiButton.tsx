import { memo } from 'react'
import { motion } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { glassStyle } from '@/lib/glass'
import { useCompanionStore } from '@/stores/companionStore'

export const AiButton = memo(function AiButton() {
  const open = useCompanionStore((s) => s.open)
  const setAutoScreenshot = useCompanionStore((s) => s.setAutoScreenshot)
  const visible = useCompanionStore((s) => s.visible)

  const handleClick = () => {
    if (visible) {
      useCompanionStore.getState().close()
      return
    }

    // Open panel immediately — capture + OCR happen in background (invisible to user)
    open()
    window.electronAPI.captureActiveWindow().then((result) => {
      if (result) setAutoScreenshot(result)
    })
  }

  return (
    <motion.button
      className="relative w-9 h-9 rounded-full backdrop-blur-2xl backdrop-saturate-[1.8]
        bg-[var(--g-bg)] border-[0.5px] border-[var(--g-line)] text-[var(--g-text)]
        hover:bg-[var(--g-bg-active)] hover:border-[var(--g-line-hover)] hover:text-[var(--g-text-bright)]
        flex items-center justify-center cursor-pointer
        transition-colors duration-200 outline-none"
      style={glassStyle}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.97 }}
      onClick={handleClick}
    >
      <Sparkles size={16} strokeWidth={2.5} />
    </motion.button>
  )
})
