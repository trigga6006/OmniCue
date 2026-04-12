import { motion } from 'motion/react'
import { useRef, useLayoutEffect, useState, useEffect } from 'react'

/**
 * Flex-layout-aware animation wrapper. Smoothly expands/collapses
 * width using measured content width + opacity fade.
 * overflow:visible so scale transforms, glow halos, and pulse rings
 * are never clipped. Uses easeOut tween (no spring overshoot).
 *
 * Uses ResizeObserver so internal width changes (e.g. notification
 * bubble expanding to pill) also animate the slot correctly.
 */
const transition = { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const }

export function AnimatedSlot({
  children,
  className = '',
  dataInteractive = false,
}: {
  children: React.ReactNode
  className?: string
  dataInteractive?: boolean
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // Initial measurement (synchronous, before paint)
  useLayoutEffect(() => {
    if (innerRef.current) setWidth(innerRef.current.scrollWidth)
  }, [children])

  // ResizeObserver: tracks internal width changes (e.g. pill expansion)
  useEffect(() => {
    if (!innerRef.current) return
    const ro = new ResizeObserver(() => {
      if (innerRef.current) setWidth(innerRef.current.scrollWidth)
    })
    ro.observe(innerRef.current)
    return () => ro.disconnect()
  }, [])

  return (
    <motion.div
      // No overflow-hidden — rely on opacity for visual enter/exit.
      // overflow:visible lets scale transforms, glow halos, and pulse rings
      // render outside the measured width without being clipped.
      // The animated `width` still controls flex layout space correctly.
      className={`shrink-0 ${className}`}
      initial={{ width: 0, opacity: 0, marginLeft: 0 }}
      animate={{ width: width || 'auto', opacity: 1, marginLeft: 8 }}
      exit={{ width: 0, opacity: 0, marginLeft: 0 }}
      transition={transition}
      {...(dataInteractive ? { 'data-interactive': true } : {})}
    >
      <div ref={innerRef} className="w-fit">
        {children}
      </div>
    </motion.div>
  )
}
