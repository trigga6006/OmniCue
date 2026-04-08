import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Clock, Settings, Trash2, X, CheckCircle2, AlertCircle,
  Bell, Repeat, Timer, Plus, Pencil, Sparkles
} from 'lucide-react'
import claudeLogo from '@/assets/claude-logo.svg'
import codexLogo from '@/assets/codex-logo.svg'
import { useSettingsStore } from '@/stores/settingsStore'
import { useHistoryStore } from '@/stores/historyStore'
import { parseDuration } from '@/lib/parseDuration'
import { formatTime, timeAgo, generateId } from '@/lib/utils'
import type { EntryType, Alarm, Reminder, HistoryEntry } from '@/lib/types'

type Tab = 'history' | 'settings' | 'alarms' | 'reminders' | 'ai'

function getInitialTab(): Tab {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const t = params.get('tab') as Tab
  return ['history', 'settings', 'alarms', 'reminders', 'ai'].includes(t) ? t : 'settings'
}

export function SettingsWindow() {
  const [tab, setTab] = useState<Tab>(getInitialTab)
  const { settings, load: loadSettings, update } = useSettingsStore()
  const { entries, load: loadHistory, clear: clearHistory, addLocal } = useHistoryStore()

  useEffect(() => {
    loadSettings()
    loadHistory()

    const unsubTab = window.electronAPI.onSwitchTab((t) => {
      if (['history', 'settings', 'alarms', 'reminders', 'ai'].includes(t)) setTab(t as Tab)
    })
    const unsubHistory = window.electronAPI.onNewHistoryEntry((entry: unknown) => {
      addLocal(entry as HistoryEntry)
    })
    return () => {
      unsubTab()
      unsubHistory()
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-[#1a1a1a] text-white/90 select-none">
      {/* Title bar (draggable) */}
      <div
        className="flex items-center justify-between px-4 h-10 shrink-0 border-b border-white/[0.06]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-[13px] font-medium text-white/50">OmniCue</span>
        <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => window.close()}
            className="flex items-center justify-center w-8 h-8 rounded-md
              text-white/35 hover:text-white/80 hover:bg-white/[0.08]
              transition-colors duration-150 cursor-pointer outline-none"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex px-4 gap-1 border-b border-white/[0.06]">
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
          <Settings size={13} />
          Settings
        </TabButton>
        <TabButton active={tab === 'alarms'} onClick={() => setTab('alarms')}>
          <Bell size={13} />
          Alarms
        </TabButton>
        <TabButton active={tab === 'reminders'} onClick={() => setTab('reminders')}>
          <Repeat size={13} />
          Reminders
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
          <Clock size={13} />
          History
        </TabButton>
        <TabButton active={tab === 'ai'} onClick={() => setTab('ai')}>
          <Sparkles size={13} />
          AI
        </TabButton>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-none">
        {tab === 'settings' && <SettingsTab settings={settings} update={update} />}
        {tab === 'alarms' && <AlarmsTab />}
        {tab === 'reminders' && <RemindersTab />}
        {tab === 'history' && <HistoryTab entries={entries} clearHistory={clearHistory} />}
        {tab === 'ai' && <AiTab settings={settings} update={update} />}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium cursor-pointer
        transition-colors duration-150 outline-none
        ${active ? 'text-white/90' : 'text-white/40 hover:text-white/60'}`}
      onClick={onClick}
    >
      {children}
      {active && (
        <motion.div
          className="absolute bottom-0 left-3 right-3 h-[2px] bg-white/60 rounded-full"
          layoutId="tab-indicator"
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
    </button>
  )
}

function SettingsTab({
  settings,
  update,
}: {
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
  update: ReturnType<typeof useSettingsStore.getState>['update']
}) {
  const [durationInput, setDurationInput] = useState(formatTime(settings.defaultDuration))

  const handleDurationBlur = () => {
    const seconds = parseDuration(durationInput)
    if (seconds && seconds > 0) {
      update({ defaultDuration: seconds })
    } else {
      setDurationInput(formatTime(settings.defaultDuration))
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* General */}
      <Section title="General">
        <Row label="Default timer duration">
          <input
            type="text"
            value={durationInput}
            onChange={(e) => setDurationInput(e.target.value)}
            onBlur={handleDurationBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleDurationBlur()}
            className="w-20 text-right bg-white/[0.06] rounded-lg px-3 py-1.5
              text-[13px] text-white/80 border border-white/[0.08] outline-none
              focus:border-white/[0.2] transition-colors"
          />
        </Row>
        <Row label="Launch on startup">
          <Toggle
            checked={settings.autoLaunch}
            onChange={(v) => update({ autoLaunch: v })}
          />
        </Row>
        <Row label="Dark mode">
          <Toggle
            checked={settings.theme === 'dark'}
            onChange={(v) => update({ theme: v ? 'dark' : 'light' })}
          />
        </Row>
      </Section>

      {/* Sound */}
      <Section title="Sound">
        <Row label="Enable sound">
          <Toggle
            checked={settings.soundEnabled}
            onChange={(v) => update({ soundEnabled: v })}
          />
        </Row>
        {settings.soundEnabled && (
          <Row label="Volume">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.soundVolume}
                onChange={(e) => update({ soundVolume: parseFloat(e.target.value) })}
                className="w-28 h-[3px] rounded-full appearance-none bg-white/[0.1] cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80"
              />
              <span className="text-[12px] text-white/40 w-8 text-right tabular-nums">
                {Math.round(settings.soundVolume * 100)}%
              </span>
            </div>
          </Row>
        )}
      </Section>

      {/* Full-Screen Alerts */}
      <Section title="Full-Screen Alerts">
        <Row label="Alarms">
          <Toggle
            checked={settings.fullScreenAlarms}
            onChange={(v) => update({ fullScreenAlarms: v })}
          />
        </Row>
        <Row label="Reminders">
          <Toggle
            checked={settings.fullScreenReminders}
            onChange={(v) => update({ fullScreenReminders: v })}
          />
        </Row>
        <Row label="Claude / Codex">
          <Toggle
            checked={settings.fullScreenClaude}
            onChange={(v) => update({ fullScreenClaude: v })}
          />
        </Row>
        <Row label="Test full-screen alert">
          <button
            onClick={() => window.electronAPI.sendTestAlert()}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium
              bg-white/[0.08] text-white/70 hover:bg-white/[0.14] hover:text-white/90
              border border-white/[0.08] transition-colors duration-150 cursor-pointer outline-none"
          >
            Test
          </button>
        </Row>
      </Section>

      {/* AI Integrations */}
      <Section title="Claude Code">
        <ClaudeCodeRow />
      </Section>
      <Section title="Codex">
        <CodexRow />
      </Section>
    </div>
  )
}

// ── Alarms Tab ────────────────────────────────────────────────────────────────

function AlarmsTab() {
  const [alarms, setAlarms] = useState<Alarm[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Alarm | null>(null)

  useEffect(() => {
    window.electronAPI.getAlarms().then((a) => setAlarms(a as Alarm[]))
  }, [])

  const saveAlarm = async (alarm: Alarm) => {
    await window.electronAPI.setAlarm(alarm)
    setAlarms((prev) => {
      const idx = prev.findIndex((a) => a.id === alarm.id)
      return idx >= 0 ? prev.map((a) => (a.id === alarm.id ? alarm : a)) : [alarm, ...prev]
    })
    setShowForm(false)
    setEditing(null)
  }

  const deleteAlarm = async (id: string) => {
    await window.electronAPI.deleteAlarm(id)
    setAlarms((prev) => prev.filter((a) => a.id !== id))
  }

  const toggleAlarm = async (alarm: Alarm) => {
    const updated = { ...alarm, enabled: !alarm.enabled }
    await window.electronAPI.setAlarm(updated)
    setAlarms((prev) => prev.map((a) => (a.id === alarm.id ? updated : a)))
  }

  const startEdit = (alarm: Alarm) => {
    setEditing(alarm)
    setShowForm(true)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditing(null)
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-white/35">
          {alarms.length} {alarms.length === 1 ? 'alarm' : 'alarms'}
        </span>
        {!showForm && (
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium
              bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.07]
              text-white/60 hover:text-white/80 transition-colors cursor-pointer outline-none"
          >
            <Plus size={11} />
            Add alarm
          </button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <AlarmForm initial={editing} onSave={saveAlarm} onCancel={cancelForm} />
          </motion.div>
        )}
      </AnimatePresence>

      {alarms.length === 0 && !showForm ? (
        <div className="text-center py-14">
          <Bell size={22} className="mx-auto mb-3 text-white/10" />
          <p className="text-[13px] text-white/25">No alarms set</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {alarms.map((alarm) => (
            <AlarmCard
              key={alarm.id}
              alarm={alarm}
              onToggle={() => toggleAlarm(alarm)}
              onEdit={() => startEdit(alarm)}
              onDelete={() => deleteAlarm(alarm.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AlarmForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Alarm | null
  onSave: (alarm: Alarm) => void
  onCancel: () => void
}) {
  const [time, setTime] = useState(initial?.time ?? '09:00')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [repeat, setRepeat] = useState(initial?.repeat ?? false)

  const handleSave = () => {
    if (!time) return
    onSave({
      id: initial?.id ?? generateId(),
      label: label.trim() || 'Alarm',
      time,
      repeat,
      enabled: initial?.enabled ?? true,
      lastFiredDate: initial?.lastFiredDate,
    })
  }

  return (
    <div className="bg-white/[0.04] rounded-xl border border-white/[0.07] p-4 space-y-3 mb-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-[11px] text-white/35 uppercase tracking-wider mb-1.5 block">Time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full bg-white/[0.06] rounded-lg px-3 py-2
              text-[13px] text-white/80 border border-white/[0.08] outline-none
              focus:border-white/[0.2] transition-colors"
          />
        </div>
        <div className="flex-1">
          <label className="text-[11px] text-white/35 uppercase tracking-wider mb-1.5 block">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Alarm"
            className="w-full bg-white/[0.06] rounded-lg px-3 py-2
              text-[13px] text-white/80 border border-white/[0.08] outline-none
              focus:border-white/[0.2] transition-colors placeholder:text-white/20"
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Toggle checked={repeat} onChange={setRepeat} />
          <span className="text-[12px] text-white/50">Repeat daily</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-[12px] text-white/35 hover:text-white/55
              transition-colors cursor-pointer outline-none"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium
              bg-white/[0.1] hover:bg-white/[0.15] border border-white/[0.1]
              text-white/75 hover:text-white/90 transition-colors cursor-pointer outline-none"
          >
            {initial ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AlarmCard({
  alarm,
  onToggle,
  onEdit,
  onDelete,
}: {
  alarm: Alarm
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors group">
      <Bell size={14} className="text-amber-400/60 shrink-0" strokeWidth={2} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-white/70 truncate">{alarm.label}</div>
        <div className="text-[11px] text-white/30">{alarm.time}{alarm.repeat ? ' · daily' : ''}</div>
      </div>
      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md text-white/25 hover:text-white/55 hover:bg-white/[0.06]
            transition-colors cursor-pointer outline-none"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md text-white/25 hover:text-red-400/60 hover:bg-white/[0.06]
            transition-colors cursor-pointer outline-none"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <Toggle checked={alarm.enabled} onChange={() => onToggle()} />
    </div>
  )
}

// ── Reminders Tab ─────────────────────────────────────────────────────────────

const INTERVAL_OPTIONS = [
  { label: '5 min', value: 5 },
  { label: '10 min', value: 10 },
  { label: '15 min', value: 15 },
  { label: '20 min', value: 20 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '1 hr', value: 60 },
  { label: '1.5 hr', value: 90 },
  { label: '2 hr', value: 120 },
  { label: '2.5 hr', value: 150 },
  { label: '3 hr', value: 180 },
  { label: '4 hr', value: 240 },
]

function RemindersTab() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Reminder | null>(null)

  useEffect(() => {
    window.electronAPI.getReminders().then((r) => setReminders(r as Reminder[]))
  }, [])

  const saveReminder = async (reminder: Reminder) => {
    await window.electronAPI.setReminder(reminder)
    setReminders((prev) => {
      const idx = prev.findIndex((r) => r.id === reminder.id)
      return idx >= 0 ? prev.map((r) => (r.id === reminder.id ? reminder : r)) : [reminder, ...prev]
    })
    setShowForm(false)
    setEditing(null)
  }

  const deleteReminder = async (id: string) => {
    await window.electronAPI.deleteReminder(id)
    setReminders((prev) => prev.filter((r) => r.id !== id))
  }

  const toggleReminder = async (reminder: Reminder) => {
    const updated = { ...reminder, enabled: !reminder.enabled }
    await window.electronAPI.setReminder(updated)
    setReminders((prev) => prev.map((r) => (r.id === reminder.id ? updated : r)))
  }

  const startEdit = (reminder: Reminder) => {
    setEditing(reminder)
    setShowForm(true)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditing(null)
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-white/35">
          {reminders.length} {reminders.length === 1 ? 'reminder' : 'reminders'}
        </span>
        {!showForm && (
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium
              bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.07]
              text-white/60 hover:text-white/80 transition-colors cursor-pointer outline-none"
          >
            <Plus size={11} />
            Add reminder
          </button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <ReminderForm initial={editing} onSave={saveReminder} onCancel={cancelForm} />
          </motion.div>
        )}
      </AnimatePresence>

      {reminders.length === 0 && !showForm ? (
        <div className="text-center py-14">
          <Repeat size={22} className="mx-auto mb-3 text-white/10" />
          <p className="text-[13px] text-white/25">No reminders set</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {reminders.map((reminder) => (
            <ReminderCard
              key={reminder.id}
              reminder={reminder}
              onToggle={() => toggleReminder(reminder)}
              onEdit={() => startEdit(reminder)}
              onDelete={() => deleteReminder(reminder.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ReminderForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Reminder | null
  onSave: (reminder: Reminder) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [intervalMinutes, setIntervalMinutes] = useState(initial?.intervalMinutes ?? 30)

  const handleSave = () => {
    onSave({
      id: initial?.id ?? generateId(),
      label: label.trim() || 'Reminder',
      intervalMinutes,
      enabled: initial?.enabled ?? true,
      nextFireAt: initial?.nextFireAt ?? Date.now() + intervalMinutes * 60 * 1000,
    })
  }

  return (
    <div className="bg-white/[0.04] rounded-xl border border-white/[0.07] p-4 space-y-3 mb-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-[11px] text-white/35 uppercase tracking-wider mb-1.5 block">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Drink water"
            className="w-full bg-white/[0.06] rounded-lg px-3 py-2
              text-[13px] text-white/80 border border-white/[0.08] outline-none
              focus:border-white/[0.2] transition-colors placeholder:text-white/20"
          />
        </div>
        <div className="flex-1">
          <label className="text-[11px] text-white/35 uppercase tracking-wider mb-1.5 block">Interval</label>
          <select
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            className="w-full bg-white/[0.06] rounded-lg px-3 py-2
              text-[13px] text-white/80 border border-white/[0.08] outline-none
              focus:border-white/[0.2] transition-colors cursor-pointer appearance-none"
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-[12px] text-white/35 hover:text-white/55
            transition-colors cursor-pointer outline-none"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium
            bg-white/[0.1] hover:bg-white/[0.15] border border-white/[0.1]
            text-white/75 hover:text-white/90 transition-colors cursor-pointer outline-none"
        >
          {initial ? 'Update' : 'Add'}
        </button>
      </div>
    </div>
  )
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} min`
  const h = minutes / 60
  return h === 1 ? 'Every hour' : `Every ${h} hrs`
}

function ReminderCard({
  reminder,
  onToggle,
  onEdit,
  onDelete,
}: {
  reminder: Reminder
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors group">
      <Repeat size={14} className="text-sky-400/60 shrink-0" strokeWidth={2} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-white/70 truncate">{reminder.label}</div>
        <div className="text-[11px] text-white/30">{formatInterval(reminder.intervalMinutes)}</div>
      </div>
      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md text-white/25 hover:text-white/55 hover:bg-white/[0.06]
            transition-colors cursor-pointer outline-none"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md text-white/25 hover:text-red-400/60 hover:bg-white/[0.06]
            transition-colors cursor-pointer outline-none"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <Toggle checked={reminder.enabled} onChange={() => onToggle()} />
    </div>
  )
}

// ── History Tab ───────────────────────────────────────────────────────────────

function TypeIcon({ type }: { type?: EntryType }) {
  switch (type) {
    case 'alarm':
      return <Bell size={14} className="text-amber-400/70 shrink-0" strokeWidth={2} />
    case 'reminder':
      return <Repeat size={14} className="text-sky-400/70 shrink-0" strokeWidth={2} />
    case 'claude':
      return <img src={claudeLogo} alt="Claude" className="shrink-0" style={{ width: 14, height: 14 }} />
    case 'codex':
      return <img src={codexLogo} alt="Codex" className="shrink-0" style={{ width: 14, height: 14 }} />
    default:
      return <Timer size={14} className="text-white/25 shrink-0" strokeWidth={2} />
  }
}

function entrySubtitle(entry: HistoryEntry): string {
  if (entry.type === 'alarm') return 'alarm'
  if (entry.type === 'reminder') return 'reminder'
  if (entry.type === 'claude') return 'Claude Code'
  if (entry.type === 'codex') return 'Codex'
  return formatTime(entry.duration)
}

function HistoryTab({
  entries,
  clearHistory,
}: {
  entries: ReturnType<typeof useHistoryStore.getState>['entries']
  clearHistory: () => void
}) {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[12px] text-white/40">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
        {entries.length > 0 && (
          <button
            onClick={clearHistory}
            className="flex items-center gap-1.5 text-[12px] text-white/30 hover:text-white/60
              transition-colors cursor-pointer"
          >
            <Trash2 size={11} />
            Clear all
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-16">
          <Clock size={24} className="mx-auto mb-3 text-white/10" />
          <p className="text-[13px] text-white/25">No history yet</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {entries.map((entry, i) => (
            <motion.div
              key={entry.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg
                hover:bg-white/[0.04] transition-colors"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
            >
              <TypeIcon type={entry.type} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-white/70 truncate">{entry.name}</div>
                <div className="text-[11px] text-white/30">{entrySubtitle(entry)}</div>
              </div>
              <div className="text-[11px] text-white/25 shrink-0">
                {timeAgo(entry.completedAt)}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

function AiTab({
  settings,
  update,
}: {
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
  update: ReturnType<typeof useSettingsStore.getState>['update']
}) {
  return (
    <div className="p-6 space-y-6">
      <Section title="AI Provider">
        <Row label="API Key">
          <input
            type="password"
            value={settings.aiApiKey}
            onChange={(e) => update({ aiApiKey: e.target.value })}
            placeholder="sk-..."
            className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
              text-[13px] text-white/80 border border-white/[0.08] outline-none
              focus:border-white/[0.2] transition-colors placeholder:text-white/20"
          />
        </Row>
        <Row label="Model">
          <input
            type="text"
            value={settings.aiModel}
            onChange={(e) => update({ aiModel: e.target.value })}
            placeholder="gpt-4o"
            className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
              text-[13px] text-white/80 border border-white/[0.08] outline-none
              focus:border-white/[0.2] transition-colors placeholder:text-white/20"
          />
        </Row>
        <Row label="Base URL">
          <input
            type="text"
            value={settings.aiBaseUrl}
            onChange={(e) => update({ aiBaseUrl: e.target.value })}
            placeholder="Leave empty for default"
            className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
              text-[13px] text-white/80 border border-white/[0.08] outline-none
              focus:border-white/[0.2] transition-colors placeholder:text-white/20"
          />
        </Row>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-white/30 mb-3">
        {title}
      </h3>
      <div className="space-y-1 bg-white/[0.03] rounded-xl border border-white/[0.05] divide-y divide-white/[0.04]">
        {children}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[13px] text-white/65">{label}</span>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-200 cursor-pointer outline-none
        ${checked ? 'bg-[#34C759]/70' : 'bg-white/[0.08]'}`}
      onClick={() => onChange(!checked)}
    >
      <motion.div
        className="absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.25), 0 0 0 0.5px rgba(0,0,0,0.04)' }}
        animate={{ left: checked ? 19 : 3 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  )
}

type IntegrationStatus = 'checking' | 'installed' | 'not-installed'

function CodexRow() {
  const [status, setStatus] = useState<IntegrationStatus>('checking')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.checkCodexIntegration().then((installed) =>
      setStatus(installed ? 'installed' : 'not-installed'),
    )
  }, [])

  const install = async () => {
    setLoading(true)
    setError(null)
    const result = await window.electronAPI.installCodexIntegration()
    if (result.ok) {
      setStatus('installed')
    } else {
      setError(result.error ?? 'Unknown error')
    }
    setLoading(false)
  }

  const uninstall = async () => {
    setLoading(true)
    setError(null)
    const result = await window.electronAPI.uninstallCodexIntegration()
    if (result.ok) {
      setStatus('not-installed')
    } else {
      setError(result.error ?? 'Unknown error')
    }
    setLoading(false)
  }

  return (
    <div className="px-4 py-3.5 space-y-3">
      <p className="text-[12px] text-white/35 leading-relaxed">
        Adds a block to{' '}
        <code className="px-1 py-0.5 rounded bg-white/[0.06] text-white/50 text-[11px] font-mono">
          ~/.codex/instructions.md
        </code>{' '}
        instructing Codex to proactively notify you via OmniCue when it finishes
        significant tasks.
      </p>

      <div className="flex items-center justify-between">
        <AnimatePresence mode="wait">
          {status === 'checking' ? (
            <motion.span
              key="checking"
              className="text-[12px] text-white/25"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Checking…
            </motion.span>
          ) : status === 'installed' ? (
            <motion.div
              key="installed"
              className="flex items-center gap-2"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
            >
              <CheckCircle2 size={13} className="text-emerald-400/80" strokeWidth={2} />
              <span className="text-[12px] text-emerald-400/70">Active in all sessions</span>
            </motion.div>
          ) : (
            <motion.span
              key="not-installed"
              className="text-[12px] text-white/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Not installed
            </motion.span>
          )}
        </AnimatePresence>

        {status !== 'checking' && (
          status === 'installed' ? (
            <button
              onClick={uninstall}
              disabled={loading}
              className="text-[12px] text-white/25 hover:text-white/50 transition-colors
                cursor-pointer disabled:opacity-40 outline-none"
            >
              {loading ? 'Removing…' : 'Uninstall'}
            </button>
          ) : (
            <button
              onClick={install}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium
                bg-white/[0.08] hover:bg-white/[0.13] border border-white/[0.08]
                text-white/70 hover:text-white/90 transition-colors
                cursor-pointer disabled:opacity-40 outline-none"
            >
              {loading ? 'Installing…' : 'Install'}
            </button>
          )
        )}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            className="flex items-start gap-2 text-[11px] text-red-400/70"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ClaudeCodeRow() {
  const [status, setStatus] = useState<IntegrationStatus>('checking')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.checkClaudeIntegration().then((installed) =>
      setStatus(installed ? 'installed' : 'not-installed'),
    )
  }, [])

  const install = async () => {
    setLoading(true)
    setError(null)
    const result = await window.electronAPI.installClaudeIntegration()
    if (result.ok) {
      setStatus('installed')
    } else {
      setError(result.error ?? 'Unknown error')
    }
    setLoading(false)
  }

  const uninstall = async () => {
    setLoading(true)
    setError(null)
    const result = await window.electronAPI.uninstallClaudeIntegration()
    if (result.ok) {
      setStatus('not-installed')
    } else {
      setError(result.error ?? 'Unknown error')
    }
    setLoading(false)
  }

  return (
    <div className="px-4 py-3.5 space-y-3">
      <p className="text-[12px] text-white/35 leading-relaxed">
        Adds a block to{' '}
        <code className="px-1 py-0.5 rounded bg-white/[0.06] text-white/50 text-[11px] font-mono">
          ~/.claude/CLAUDE.md
        </code>{' '}
        instructing Claude to proactively notify you via OmniCue when it finishes
        significant tasks.
      </p>

      <div className="flex items-center justify-between">
        <AnimatePresence mode="wait">
          {status === 'checking' ? (
            <motion.span
              key="checking"
              className="text-[12px] text-white/25"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Checking…
            </motion.span>
          ) : status === 'installed' ? (
            <motion.div
              key="installed"
              className="flex items-center gap-2"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
            >
              <CheckCircle2 size={13} className="text-emerald-400/80" strokeWidth={2} />
              <span className="text-[12px] text-emerald-400/70">Active in all sessions</span>
            </motion.div>
          ) : (
            <motion.span
              key="not-installed"
              className="text-[12px] text-white/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Not installed
            </motion.span>
          )}
        </AnimatePresence>

        {status !== 'checking' && (
          status === 'installed' ? (
            <button
              onClick={uninstall}
              disabled={loading}
              className="text-[12px] text-white/25 hover:text-white/50 transition-colors
                cursor-pointer disabled:opacity-40 outline-none"
            >
              {loading ? 'Removing…' : 'Uninstall'}
            </button>
          ) : (
            <button
              onClick={install}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium
                bg-white/[0.08] hover:bg-white/[0.13] border border-white/[0.08]
                text-white/70 hover:text-white/90 transition-colors
                cursor-pointer disabled:opacity-40 outline-none"
            >
              {loading ? 'Installing…' : 'Install'}
            </button>
          )
        )}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            className="flex items-start gap-2 text-[11px] text-red-400/70"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
