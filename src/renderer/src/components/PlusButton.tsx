import { memo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Plus } from 'lucide-react'
import { useTimerStore } from '@/stores/timerStore'
import { glassStyle } from '@/lib/glass'

function GripDots(): React.ReactElement {
  return (
    <div className="flex gap-[3px]">
      {[0, 1].map((col) => (
        <div key={col} className="flex flex-col gap-[3px]">
          {[0, 1, 2].map((row) => (
            <div key={row} className="w-[3px] h-[3px] rounded-full bg-[var(--g-grip)]" />
          ))}
        </div>
      ))}
    </div>
  )
}

export const PlusButton = memo(function PlusButton({
  onContextMenu,
  showGrip,
  onGripMouseDown
}: {
  onContextMenu: (e: React.MouseEvent) => void
  showGrip: boolean
  onGripMouseDown: (e: React.MouseEvent) => void
}) {
  const { isCreating, setCreating } = useTimerStore()

  return (
    <div className="flex items-center">
      <AnimatePresence>
        {showGrip && !isCreating && (
          <motion.div
            className="flex items-center justify-center w-5 h-9 cursor-grab active:cursor-grabbing"
            initial={{ width: 0, opacity: 0, marginRight: 0 }}
            animate={{ width: 20, opacity: 1, marginRight: 6 }}
            exit={{ width: 0, opacity: 0, marginRight: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            onMouseDown={onGripMouseDown}
          >
            <GripDots />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        className="relative w-9 h-9 rounded-full backdrop-blur-2xl backdrop-saturate-[1.8]
          bg-[var(--g-bg)] border-[0.5px] border-[var(--g-line)] text-[var(--g-text)]
          hover:bg-[var(--g-bg-active)] hover:border-[var(--g-line-hover)] hover:text-[var(--g-text-bright)]
          flex items-center justify-center cursor-pointer
          transition-colors duration-200 outline-none"
        style={glassStyle}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => setCreating(!isCreating)}
        onContextMenu={onContextMenu}
      >
        <motion.div
          animate={{ rotate: isCreating ? 45 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <Plus size={16} strokeWidth={2.5} />
        </motion.div>
      </motion.button>
    </div>
  )
})
