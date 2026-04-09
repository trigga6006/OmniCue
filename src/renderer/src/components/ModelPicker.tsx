import { memo, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useCompanionStore } from '@/stores/companionStore'
import { MODE_LABELS, type AiMode } from '@/lib/modelRouter'
import type { AiProvider } from '@/lib/types'

export const ModelPicker = memo(function ModelPicker() {
  const aiMode = useCompanionStore((s) => s.aiMode)
  const setAiMode = useCompanionStore((s) => s.setAiMode)
  const [provider, setProvider] = useState<AiProvider>('codex')

  useEffect(() => {
    window.electronAPI.getSettings().then((s) => {
      setProvider(s.aiProvider || 'codex')
    })
  }, [])

  const labels = MODE_LABELS[provider]
  const modes: { key: AiMode; label: string }[] = [
    { key: 'fast', label: labels.fast },
    { key: 'auto', label: labels.auto },
    { key: 'pro', label: labels.pro },
  ]

  return (
    <div className="flex h-[22px] rounded-lg bg-[rgba(255,255,255,0.05)] border-[0.5px] border-[rgba(255,255,255,0.08)] p-[2px] gap-[1px]">
      {modes.map((m) => (
        <button
          key={m.key}
          onClick={() => setAiMode(m.key)}
          className={`relative px-2.5 text-[10px] font-medium rounded-md transition-colors cursor-pointer ${
            aiMode === m.key
              ? 'text-[var(--g-text-bright)]'
              : 'text-[var(--g-text-secondary)] hover:text-[var(--g-text)]'
          }`}
        >
          {aiMode === m.key && (
            <motion.div
              layoutId="model-picker-pill"
              className="absolute inset-0 rounded-md bg-[rgba(255,255,255,0.1)]"
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          )}
          <span className="relative z-10">{m.label}</span>
        </button>
      ))}
    </div>
  )
})
