import { memo, useEffect, useState } from 'react'
import type { AiProvider } from '@/lib/types'
import codexLogo from '@/assets/codex-color.svg'
import claudeCodeLogo from '@/assets/claudecode-color.svg'

const PROVIDER_INFO: Record<AiProvider, { logo: string; name: string }> = {
  codex: { logo: codexLogo, name: 'Codex' },
  claude: { logo: claudeCodeLogo, name: 'Claude Code' },
  openai: { logo: codexLogo, name: 'OpenAI' },
}

export const ProviderBadge = memo(function ProviderBadge() {
  const [provider, setProvider] = useState<AiProvider>('codex')

  useEffect(() => {
    window.electronAPI.getSettings().then((s) => {
      if (s.aiProvider) setProvider(s.aiProvider)
    })
  }, [])

  const info = PROVIDER_INFO[provider]

  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg
      bg-[rgba(255,255,255,0.05)] border-[0.5px] border-[rgba(255,255,255,0.08)]">
      <img src={info.logo} alt="" className="w-3.5 h-3.5" />
      <span className="text-[10px] font-medium text-[var(--g-text-secondary)]">
        {info.name}
      </span>
    </div>
  )
})
