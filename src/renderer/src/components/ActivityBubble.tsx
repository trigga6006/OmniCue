import { memo } from 'react'
import { motion } from 'motion/react'
import { useCompanionStore } from '@/stores/companionStore'
import oiLogoGlass from '@/assets/oi-logo-glass.svg'

/** Spinning logo indicator that appears in the pill when an agent is actively streaming */
export const ActivityBubble = memo(function ActivityBubble() {
  const handleClick = () => {
    useCompanionStore.getState().open()
    window.electronAPI.captureActiveWindow().then((result) => {
      if (result) useCompanionStore.getState().captureAndResolve(result)
    })
  }

  return (
    <motion.button
      className="relative w-7 h-7 rounded-full flex items-center justify-center cursor-pointer outline-none"
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      onClick={handleClick}
      initial={{ width: 0, opacity: 0, marginLeft: 0 }}
      animate={{ width: 28, opacity: 1, marginLeft: 4 }}
      exit={{ width: 0, opacity: 0, marginLeft: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {/* Pulsing glow */}
      <motion.div
        className="absolute inset-[-2px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%)' }}
        animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.9, 1.15, 0.9] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Spinning logo — same animation as the thinking state in CompanionMessage */}
      <motion.img
        src={oiLogoGlass}
        alt=""
        className="w-4 h-4 relative pointer-events-none"
        animate={{
          rotate: 360,
          opacity: [0.7, 1, 0.7],
          scale: [0.97, 1.03, 0.97],
        }}
        transition={{
          rotate: { duration: 2.4, repeat: Infinity, ease: 'linear' },
          opacity: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' },
          scale: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' },
        }}
      />
    </motion.button>
  )
})
