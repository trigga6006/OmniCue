import { memo, useState, useCallback } from 'react'
import { Shield, ShieldCheck, ShieldX, Terminal, FileText, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react'
import type { AgentInteractionRequest, AgentInteractionResponse, AgentInteractionQuestion } from '@/lib/types'
import { useCompanionStore } from '@/stores/companionStore'

interface InteractionCardProps {
  interaction: AgentInteractionRequest
}

const KIND_ICONS: Record<string, typeof Terminal> = {
  'command-approval': Terminal,
  'file-change-approval': FileText,
}

function StatusIcon({ status }: { status: AgentInteractionRequest['status'] }) {
  if (status === 'resolved' || status === 'submitted') return <ShieldCheck size={12} className="text-emerald-400/80" />
  if (status === 'declined' || status === 'cancelled') return <ShieldX size={12} className="text-red-400/80" />
  if (status === 'failed') return <ShieldX size={12} className="text-red-400/80" />
  return <Shield size={12} className="text-amber-400/80" />
}

function QuestionField({ question, value, onChange }: {
  question: AgentInteractionQuestion
  value: string[]
  onChange: (val: string[]) => void
}) {
  const [showSecret, setShowSecret] = useState(false)

  return (
    <div className="space-y-1.5">
      {question.header && (
        <div className="text-[11px] font-medium text-[var(--g-text)]">{question.header}</div>
      )}
      <div className="text-[11px] text-[var(--g-text-secondary)]">{question.question}</div>

      {question.options && question.options.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {question.options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => onChange(value.includes(opt.value) ? value.filter((v) => v !== opt.value) : [...value, opt.value])}
              className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer border ${
                value.includes(opt.value)
                  ? 'bg-[var(--g-bg-active)] border-[var(--g-line-hover)] text-[var(--g-text-bright)]'
                  : 'bg-[var(--g-bg-subtle)] border-[var(--g-line-faint)] text-[var(--g-text-secondary)] hover:bg-[var(--g-bg-hover)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}

      {(question.isOther || !question.options?.length) && (
        <div className="flex items-center gap-1">
          <input
            type={question.isSecret && !showSecret ? 'password' : 'text'}
            value={value[0] || ''}
            onChange={(e) => onChange([e.target.value])}
            className="flex-1 bg-[var(--g-bg-subtle)] rounded-md px-2 py-1
              text-[11px] text-[var(--g-text-primary)] border border-[var(--g-line-faint)]
              outline-none focus:border-[var(--g-line-hover)] transition-colors
              placeholder:text-[var(--g-text-muted)]"
            placeholder="Type your answer..."
          />
          {question.isSecret && (
            <button
              onClick={() => setShowSecret(!showSecret)}
              className="p-1 rounded text-[var(--g-text-muted)] hover:text-[var(--g-text)] cursor-pointer"
            >
              {showSecret ? <EyeOff size={10} /> : <Eye size={10} />}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export const InteractionCard = memo(function InteractionCard({ interaction }: InteractionCardProps) {
  const resolveInteraction = useCompanionStore((s) => s.resolveInteraction)
  const [expanded, setExpanded] = useState(true)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})

  const isPending = interaction.status === 'pending'
  const Icon = KIND_ICONS[interaction.kind] || Shield

  const handleDecision = useCallback((optionValue: string) => {
    const response: AgentInteractionResponse = {
      sessionId: interaction.sessionId,
      interactionId: interaction.id,
      providerRequestId: interaction.providerRequestId,
      kind: interaction.kind,
      selectedOptionId: optionValue,
    }
    window.electronAPI.respondToAiInteraction(response)
    resolveInteraction(
      interaction.id,
      optionValue === 'decline' || optionValue === 'deny' || optionValue === 'cancel'
        ? 'declined'
        : 'resolved'
    )
  }, [interaction, resolveInteraction])

  const handleSubmitAnswers = useCallback(() => {
    const response: AgentInteractionResponse = {
      sessionId: interaction.sessionId,
      interactionId: interaction.id,
      providerRequestId: interaction.providerRequestId,
      kind: interaction.kind,
      answers,
    }
    window.electronAPI.respondToAiInteraction(response)
    resolveInteraction(interaction.id, 'submitted')
  }, [interaction, answers, resolveInteraction])

  // Collapsed view for resolved interactions
  if (!isPending) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg
        bg-[var(--g-bg-subtle)] border-[0.5px] border-[var(--g-line-faint)]
        text-[10px] text-[var(--g-text-secondary)] font-mono leading-tight">
        <StatusIcon status={interaction.status} />
        <span className="font-semibold text-[var(--g-text-muted)]">{interaction.title}</span>
        <span className="opacity-30">|</span>
        <span className="truncate opacity-70">{interaction.status}</span>
      </div>
    )
  }

  // Expanded pending view
  return (
    <div className="rounded-xl border-[0.5px] border-amber-500/30 bg-[var(--g-bg-subtle)] overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon size={12} className="text-amber-400/80 shrink-0" />
        <span className="text-[12px] font-medium text-[var(--g-text-bright)] flex-1">{interaction.title}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300/90 font-medium">
          WAITING
        </span>
        {expanded ? <ChevronUp size={10} className="text-[var(--g-text-muted)]" /> : <ChevronDown size={10} className="text-[var(--g-text-muted)]" />}
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Description / command */}
          {interaction.description && (
            <div className="text-[11px] text-[var(--g-text-primary)] font-mono bg-[var(--g-bg)] rounded-lg px-2 py-1.5 break-all">
              {interaction.description}
            </div>
          )}

          {/* Detail (cwd, diff preview, etc.) */}
          {interaction.detail && (
            <div className="text-[10px] text-[var(--g-text-muted)] truncate">
              {interaction.detail}
            </div>
          )}

          {/* Questions for user-input kind */}
          {interaction.questions && interaction.questions.length > 0 && (
            <div className="space-y-3">
              {interaction.questions.map((q) => (
                <QuestionField
                  key={q.id}
                  question={q}
                  value={answers[q.id] || []}
                  onChange={(val) => setAnswers((prev) => ({ ...prev, [q.id]: val }))}
                />
              ))}
              <button
                onClick={handleSubmitAnswers}
                className="w-full py-1.5 rounded-lg text-[11px] font-medium
                  bg-emerald-600/70 hover:bg-emerald-500/80 text-white/90
                  transition-colors cursor-pointer"
              >
                Submit
              </button>
            </div>
          )}

          {/* Decision buttons for approval kinds */}
          {interaction.options && interaction.options.length > 0 && !interaction.questions?.length && (
            <div className="flex flex-wrap gap-1.5">
              {interaction.options.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleDecision(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                    opt.style === 'primary'
                      ? 'bg-emerald-600/70 hover:bg-emerald-500/80 text-white/90'
                      : opt.style === 'danger'
                        ? 'bg-red-600/40 hover:bg-red-500/60 text-white/80'
                        : 'bg-[var(--g-bg-hover)] hover:bg-[var(--g-bg-active)] text-[var(--g-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
