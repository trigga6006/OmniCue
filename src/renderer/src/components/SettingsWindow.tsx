import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import {
  Clock, Settings, Trash2, X, CheckCircle2, AlertCircle,
  Bell, Repeat, Timer, Plus, Pencil, Sparkles, FolderOpen, ChevronDown, Keyboard
} from 'lucide-react'
import claudeLogo from '@/assets/claude-logo.svg'
import codexLogo from '@/assets/codex-logo.svg'
import { useSettingsStore } from '@/stores/settingsStore'
import { useHistoryStore } from '@/stores/historyStore'
import { parseDuration } from '@/lib/parseDuration'
import { formatTime, timeAgo, generateId } from '@/lib/utils'
import type { EntryType, Alarm, Reminder, HistoryEntry } from '@/lib/types'
import { MemoryPreviewCard } from './MemoryPreviewCard'

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
        <Row label="Dev folder">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-white/40 truncate max-w-[140px]" title={settings.devRootPath || 'Not set'}>
              {settings.devRootPath
                ? settings.devRootPath.split(/[/\\]/).slice(-2).join('/')
                : 'Not set'}
            </span>
            <button
              onClick={async () => {
                const folder = await window.electronAPI.selectFolder()
                if (folder) update({ devRootPath: folder })
              }}
              className="p-1.5 rounded-md
                bg-white/[0.08] text-white/60 hover:bg-white/[0.14] hover:text-white/90
                border border-white/[0.08] transition-colors duration-150 cursor-pointer outline-none"
              title="Browse"
            >
              <FolderOpen size={12} />
            </button>
          </div>
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
          <div className="relative">
            <select
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              className="w-full bg-white/[0.06] rounded-lg px-3 py-2 pr-8
                text-[13px] text-white/80 border border-white/[0.08] outline-none
                focus:border-white/[0.2] transition-colors cursor-pointer appearance-none
                [&>option]:bg-[#1f1f1f] [&>option]:text-white"
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/35"
            />
          </div>
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
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewCapsule, setPreviewCapsule] = useState<import('@/lib/types').ResumeCapsule | null>(null)
  const [previewLiveCtx, setPreviewLiveCtx] = useState<{ activeApp: string; processName: string; windowTitle: string } | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; width: number; direction: 'above' | 'below' }>({ top: 0, left: 0, width: 280, direction: 'above' })
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const liveCtxFetched = useRef(false)

  const cancelDismiss = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current)
      dismissTimer.current = null
    }
  }, [])

  const handleRowEnter = useCallback(async (entry: HistoryEntry) => {
    if (!entry.conversationId) return
    cancelDismiss()
    hoverTimer.current = setTimeout(async () => {
      const capsule = await window.electronAPI.sessionMemoryGetCapsule(entry.conversationId!)
      if (!capsule) return

      if (!liveCtxFetched.current) {
        try {
          const ctx = await window.electronAPI.desktopGetLiveContext()
          setPreviewLiveCtx(ctx)
        } catch { /* ignore */ }
        liveCtxFetched.current = true
      }

      // Calculate position
      const el = rowRefs.current.get(entry.id)
      if (el) {
        const rect = el.getBoundingClientRect()
        if (rect.top > 180) {
          setTooltipPos({ top: rect.top - 4, left: rect.left, width: rect.width, direction: 'above' })
        } else {
          setTooltipPos({ top: rect.bottom + 4, left: rect.left, width: rect.width, direction: 'below' })
        }
      }

      setPreviewCapsule(capsule)
      setPreviewId(entry.id)
    }, 300)
  }, [])

  const handleRowLeave = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    dismissTimer.current = setTimeout(() => {
      setPreviewId(null)
    }, 150)
  }, [])

  const handleClearMemory = useCallback(async (conversationId: string) => {
    await window.electronAPI.sessionMemoryClear(conversationId)
    setPreviewId(null)
    setPreviewCapsule(null)
  }, [])

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
            <div
              key={entry.id}
              ref={(el) => { if (el) rowRefs.current.set(entry.id, el); else rowRefs.current.delete(entry.id) }}
              onMouseEnter={() => handleRowEnter(entry)}
              onMouseLeave={handleRowLeave}
            >
              <motion.div
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
            </div>
          ))}
        </div>
      )}

      {/* Portal-based tooltip for memory preview */}
      {createPortal(
        <AnimatePresence>
          {previewId && previewCapsule && (
            <motion.div
              className="fixed z-[9999] pointer-events-none"
              style={{
                left: tooltipPos.left,
                width: tooltipPos.width,
                ...(tooltipPos.direction === 'above'
                  ? { bottom: window.innerHeight - tooltipPos.top }
                  : { top: tooltipPos.top }),
              }}
              initial={{ opacity: 0, y: tooltipPos.direction === 'above' ? 6 : -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: tooltipPos.direction === 'above' ? 6 : -6 }}
              transition={{ duration: 0.12 }}
            >
              <div
                className="pointer-events-auto"
                onMouseEnter={cancelDismiss}
                onMouseLeave={handleRowLeave}
              >
                <MemoryPreviewCard
                  capsule={previewCapsule}
                  isCurrentConversation={false}
                  liveContext={previewLiveCtx}
                  onClear={() => {
                    const entry = entries.find((e) => e.id === previewId)
                    if (entry?.conversationId) handleClearMemory(entry.conversationId)
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
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
  const [codexStatus, setCodexStatus] = useState<{
    authenticated: boolean
    planType?: string
    model?: string
    authMode?: string
  } | null>(null)

  const provider = settings.aiProvider || 'codex'

  useEffect(() => {
    window.electronAPI.getCodexStatus().then(setCodexStatus)
  }, [])

  const providerOptions = [
    { key: 'codex' as const, label: 'Codex', desc: 'OpenAI Codex CLI' },
    { key: 'claude' as const, label: 'Claude', desc: 'Anthropic Claude' },
    { key: 'opencode' as const, label: 'OpenCode', desc: 'Multi-model agent' },
    { key: 'kimicode' as const, label: 'Kimi Code', desc: 'Moonshot agent' },
    { key: 'openai' as const, label: 'OpenAI', desc: 'Direct API' },
    { key: 'gemini' as const, label: 'Gemini', desc: 'Google AI' },
    { key: 'deepseek' as const, label: 'DeepSeek', desc: 'DeepSeek API' },
    { key: 'groq' as const, label: 'Groq', desc: 'Ultra-fast inference' },
    { key: 'mistral' as const, label: 'Mistral', desc: 'Mistral AI' },
    { key: 'xai' as const, label: 'Grok', desc: 'xAI Grok' },
    { key: 'glm' as const, label: 'GLM', desc: 'Zhipu AI' },
    { key: 'kimi' as const, label: 'Kimi', desc: 'Moonshot AI' },
  ]

  const codexAuthLabel =
    codexStatus?.authMode === 'chatgpt'
      ? 'ChatGPT OAuth'
      : codexStatus?.authMode
        ? codexStatus.authMode
        : 'OAuth'

  return (
    <div className="p-6 space-y-6">
      <Section title="AI Provider">
        <div className="px-4 py-3">
          <div className="grid grid-cols-5 gap-1.5">
            {providerOptions.map((p) => (
              <button
                key={p.key}
                onClick={() => update({ aiProvider: p.key })}
                className={`px-2 py-1.5 rounded-lg text-center transition-all cursor-pointer border ${
                  provider === p.key
                    ? 'bg-white/[0.1] border-white/[0.2] text-white/90'
                    : 'bg-white/[0.03] border-white/[0.06] text-white/40 hover:bg-white/[0.06] hover:text-white/60'
                }`}
              >
                <div className="text-[12px] font-medium">{p.label}</div>
                <div className="text-[9px] mt-0.5 opacity-60 truncate">{p.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {provider === 'codex' && (
          <>
            <div className="px-4 py-3 text-[12px] text-white/35 leading-relaxed">
              {codexStatus?.authenticated ? (
                <>
                  <span className="text-green-400/80">Codex CLI authenticated</span>
                  {` via ${codexAuthLabel}`}
                  {codexStatus.planType ? ` (${codexStatus.planType})` : ''}.
                  {codexStatus.model ? ` Default model: ${codexStatus.model}.` : ''}
                  {' '}Your local Codex login will be used automatically.
                  The API key below is an optional fallback if Codex CLI is unavailable.
                </>
              ) : (
                <>
                  Codex CLI not detected. Run{' '}
                  <span className="text-white/50 font-mono">codex login</span>{' '}
                  in a terminal to authenticate with OpenAI OAuth, or add an API key below.
                </>
              )}
            </div>
            <Row label="OpenAI API Key">
              <input
                type="password"
                value={settings.aiApiKey}
                onChange={(e) => update({ aiApiKey: e.target.value })}
                placeholder="Optional fallback"
                className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
                  text-[13px] text-white/80 border border-white/[0.08] outline-none
                  focus:border-white/[0.2] transition-colors placeholder:text-white/20"
              />
            </Row>
            <Row label="Model Override">
              <input
                type="text"
                value={settings.aiModel}
                onChange={(e) => update({ aiModel: e.target.value })}
                placeholder="Leave empty for default"
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
                placeholder="Optional API fallback URL"
                className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
                  text-[13px] text-white/80 border border-white/[0.08] outline-none
                  focus:border-white/[0.2] transition-colors placeholder:text-white/20"
              />
            </Row>
          </>
        )}

        {provider === 'claude' && (
          <ClaudeSettings settings={settings} update={update} />
        )}

        {provider === 'opencode' && (
          <>
            <div className="px-4 py-3 text-[12px] text-white/35 leading-relaxed">
              OpenCode is a multi-model coding agent CLI. Install with{' '}
              <span className="text-white/50 font-mono">npm i -g opencode-ai</span>.
              {' '}Set any API key below to use any model as a coding agent.
            </div>
            <Row label="API Key">
              <input
                type="password"
                value={settings.opencodeApiKey}
                onChange={(e) => update({ opencodeApiKey: e.target.value })}
                placeholder="Any provider API key"
                className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
                  text-[13px] text-white/80 border border-white/[0.08] outline-none
                  focus:border-white/[0.2] transition-colors placeholder:text-white/20"
              />
            </Row>
            <Row label="Model">
              <input
                type="text"
                value={settings.opencodeModel}
                onChange={(e) => update({ opencodeModel: e.target.value })}
                placeholder="e.g. anthropic/claude-sonnet-4-6"
                className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
                  text-[13px] text-white/80 border border-white/[0.08] outline-none
                  focus:border-white/[0.2] transition-colors placeholder:text-white/20"
              />
            </Row>
          </>
        )}

        {provider === 'kimicode' && (
          <>
            <div className="px-4 py-3 text-[12px] text-white/35 leading-relaxed">
              Kimi Code is Moonshot AI's coding agent CLI. Install with{' '}
              <span className="text-white/50 font-mono">pip install kimi-cli</span>{' '}
              or run{' '}
              <span className="text-white/50 font-mono">kimi login</span>{' '}
              to authenticate. Falls back to Kimi API if CLI is unavailable.
            </div>
            <Row label="API Key (optional)">
              <input
                type="password"
                value={settings.kimiApiKey}
                onChange={(e) => update({ kimiApiKey: e.target.value })}
                placeholder="Uses kimi login if empty"
                className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
                  text-[13px] text-white/80 border border-white/[0.08] outline-none
                  focus:border-white/[0.2] transition-colors placeholder:text-white/20"
              />
            </Row>
          </>
        )}

        {provider === 'openai' && (
          <>
            <div className="px-4 py-3 text-[12px] text-white/35 leading-relaxed">
              Direct OpenAI API access. Requires an API key from{' '}
              <span className="text-white/50">platform.openai.com</span>.
            </div>
            <Row label="OpenAI API Key">
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
                placeholder="https://api.openai.com/v1"
                className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
                  text-[13px] text-white/80 border border-white/[0.08] outline-none
                  focus:border-white/[0.2] transition-colors placeholder:text-white/20"
              />
            </Row>
          </>
        )}

        {provider === 'gemini' && (
          <CompatProviderSettings
            settings={settings}
            update={update}
            description="Google Gemini API. Get your API key from"
            linkText="aistudio.google.com"
            apiKeyField="geminiApiKey"
            modelField="geminiModel"
            modelPlaceholder="gemini-3.1-pro"
          />
        )}

        {provider === 'deepseek' && (
          <CompatProviderSettings
            settings={settings}
            update={update}
            description="DeepSeek API with reasoning models. Get your API key from"
            linkText="platform.deepseek.com"
            apiKeyField="deepseekApiKey"
            modelField="deepseekModel"
            modelPlaceholder="deepseek-chat"
          />
        )}

        {provider === 'groq' && (
          <CompatProviderSettings
            settings={settings}
            update={update}
            description="Groq ultra-fast inference. Get your API key from"
            linkText="console.groq.com"
            apiKeyField="groqApiKey"
            modelField="groqModel"
            modelPlaceholder="meta-llama/llama-4-scout-17b-16e-instruct"
          />
        )}

        {provider === 'mistral' && (
          <CompatProviderSettings
            settings={settings}
            update={update}
            description="Mistral AI API. Get your API key from"
            linkText="console.mistral.ai"
            apiKeyField="mistralApiKey"
            modelField="mistralModel"
            modelPlaceholder="mistral-large-latest"
          />
        )}

        {provider === 'xai' && (
          <CompatProviderSettings
            settings={settings}
            update={update}
            description="xAI Grok API. Get your API key from"
            linkText="console.x.ai"
            apiKeyField="xaiApiKey"
            modelField="xaiModel"
            modelPlaceholder="grok-4"
          />
        )}

        {provider === 'glm' && (
          <CompatProviderSettings
            settings={settings}
            update={update}
            description="Zhipu AI GLM API. Get your API key from"
            linkText="open.bigmodel.cn"
            apiKeyField="glmApiKey"
            modelField="glmModel"
            modelPlaceholder="glm-5.1"
          />
        )}

        {provider === 'kimi' && (
          <CompatProviderSettings
            settings={settings}
            update={update}
            description="Moonshot Kimi API. Get your API key from"
            linkText="platform.moonshot.ai"
            apiKeyField="kimiApiKey"
            modelField="kimiModel"
            modelPlaceholder="kimi-k2.5"
          />
        )}
      </Section>

      <Section title="Agent Permissions">
        <Row label="Permission mode">
          <div className="relative">
            <select
              value={settings.agentPermissions || 'read-only'}
              onChange={(e) => update({ agentPermissions: e.target.value as 'read-only' | 'workspace-write' | 'full-access' })}
              className="bg-white/[0.06] rounded-lg px-3 py-1.5 pr-8
                text-[13px] text-white/80 border border-white/[0.08] outline-none
                focus:border-white/[0.2] transition-colors cursor-pointer appearance-none
                [&>option]:bg-[#1f1f1f] [&>option]:text-white"
            >
              <option value="read-only">Read-only</option>
              <option value="workspace-write">Workspace-write</option>
              <option value="full-access">Full-access</option>
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/35"
            />
          </div>
        </Row>
        <div className="px-4 pb-3 text-[11px] text-white/30 leading-relaxed">
          {settings.agentPermissions === 'full-access'
            ? 'Agents can inspect and edit any reachable local files. Use with care.'
            : settings.agentPermissions === 'workspace-write'
              ? 'Agents can inspect files and edit within the resolved working area.'
              : 'Agents can inspect files but cannot modify them.'}
        </div>
        <div className="px-4 pb-3 space-y-1 text-[10px] text-white/20">
          {provider === 'codex' && <p>Codex honors this setting directly via sandbox policy.</p>}
          {provider === 'claude' && <p>Claude Code uses permission-mode flag; enforcement is best-effort.</p>}
          {provider === 'opencode' && <p>OpenCode uses its own permission system; configure via opencode.json.</p>}
          {provider === 'kimicode' && <p>Kimi Code manages permissions internally.</p>}
          {provider !== 'codex' && provider !== 'claude' && provider !== 'opencode' && provider !== 'kimicode' && (
            <p>API providers have no local filesystem access.</p>
          )}
        </div>
      </Section>

      <Section title="Companion Hotkey">
        <HotkeyRecorder currentAccelerator={settings.companionHotkey || 'Ctrl+Shift+Space'} />
      </Section>
    </div>
  )
}

function ClaudeSettings({
  settings,
  update,
}: {
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
  update: ReturnType<typeof useSettingsStore.getState>['update']
}) {
  const [claudeStatus, setClaudeStatus] = useState<{
    authenticated: boolean
    planType?: string
  } | null>(null)

  useEffect(() => {
    window.electronAPI.getClaudeStatus().then(setClaudeStatus)
  }, [])

  return (
    <>
      <div className="px-4 py-3 text-[12px] text-white/35 leading-relaxed">
        {claudeStatus?.authenticated ? (
          <>
            <span className="text-green-400/80">Claude Code CLI authenticated</span>
            {claudeStatus.planType ? ` (${claudeStatus.planType})` : ''}.
            {' '}Your Max subscription will be used automatically.
            The API key below is an optional fallback if the CLI is unavailable.
          </>
        ) : (
          <>
            Claude Code CLI not detected. Run{' '}
            <span className="text-white/50 font-mono">claude login</span>{' '}
            in a terminal to use your Max subscription, or add an API key below.
          </>
        )}
      </div>
      <Row label="API Key (optional)">
        <input
          type="password"
          value={settings.claudeApiKey}
          onChange={(e) => update({ claudeApiKey: e.target.value })}
          placeholder={claudeStatus?.authenticated ? 'Using Max subscription' : 'sk-ant-...'}
          className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
            text-[13px] text-white/80 border border-white/[0.08] outline-none
            focus:border-white/[0.2] transition-colors placeholder:text-white/20"
        />
      </Row>
      <Row label="Model Override">
        <input
          type="text"
          value={settings.claudeModel}
          onChange={(e) => update({ claudeModel: e.target.value })}
          placeholder="Leave empty for auto"
          className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
            text-[13px] text-white/80 border border-white/[0.08] outline-none
            focus:border-white/[0.2] transition-colors placeholder:text-white/20"
        />
      </Row>
    </>
  )
}

function CompatProviderSettings({
  settings,
  update,
  description,
  linkText,
  apiKeyField,
  modelField,
  modelPlaceholder,
}: {
  settings: ReturnType<typeof useSettingsStore.getState>['settings']
  update: ReturnType<typeof useSettingsStore.getState>['update']
  description: string
  linkText: string
  apiKeyField: keyof typeof settings
  modelField: keyof typeof settings
  modelPlaceholder: string
}) {
  return (
    <>
      <div className="px-4 py-3 text-[12px] text-white/35 leading-relaxed">
        {description}{' '}
        <span className="text-white/50">{linkText}</span>.
      </div>
      <Row label="API Key">
        <input
          type="password"
          value={(settings[apiKeyField] as string) || ''}
          onChange={(e) => update({ [apiKeyField]: e.target.value })}
          placeholder="Enter API key"
          className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
            text-[13px] text-white/80 border border-white/[0.08] outline-none
            focus:border-white/[0.2] transition-colors placeholder:text-white/20"
        />
      </Row>
      <Row label="Model">
        <input
          type="text"
          value={(settings[modelField] as string) || ''}
          onChange={(e) => update({ [modelField]: e.target.value })}
          placeholder={modelPlaceholder}
          className="w-48 bg-white/[0.06] rounded-lg px-3 py-1.5
            text-[13px] text-white/80 border border-white/[0.08] outline-none
            focus:border-white/[0.2] transition-colors placeholder:text-white/20"
        />
      </Row>
    </>
  )
}

// ─── Hotkey Recorder ──────────────────────────────────────────────────────────

/** Map e.code to a canonical Electron-accelerator part. */
const CODE_TO_ACCEL: Record<string, string> = {
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  ShiftLeft: 'Shift', ShiftRight: 'Shift',
  AltLeft: 'Alt', AltRight: 'Alt',
  MetaLeft: 'Meta', MetaRight: 'Meta',
  Space: 'Space', Tab: 'Tab', Enter: 'Enter',
  Backspace: 'Backspace', Delete: 'Delete',
  Escape: 'Escape', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
}

function codeToAccelPart(code: string): string {
  if (CODE_TO_ACCEL[code]) return CODE_TO_ACCEL[code]
  if (code.startsWith('Key')) return code.slice(3)          // KeyA → A
  if (code.startsWith('Digit')) return code.slice(5)        // Digit1 → 1
  if (code.startsWith('Numpad')) return 'num' + code.slice(6) // Numpad0 → num0
  if (/^F\d+$/.test(code)) return code                     // F1–F24
  return code
}

/** Modifiers always sort first in a stable order. */
const MOD_ORDER = ['Ctrl', 'Shift', 'Alt', 'Meta']
function buildAccelerator(parts: string[]): string {
  const mods = parts.filter((p) => MOD_ORDER.includes(p)).sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b))
  const keys = parts.filter((p) => !MOD_ORDER.includes(p))
  return [...mods, ...keys].join('+')
}

function HotkeyRecorder({ currentAccelerator }: { currentAccelerator: string }) {
  const [recording, setRecording] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [liveKeys, setLiveKeys] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const heldRef = useRef(new Set<string>())       // raw codes currently held
  const peakRef = useRef(new Set<string>())        // all codes pressed during this gesture

  const startRecording = useCallback(() => {
    setRecording(true)
    setPending(null)
    setLiveKeys([])
    setError(null)
    heldRef.current.clear()
    peakRef.current.clear()
  }, [])

  const cancel = useCallback(() => {
    setRecording(false)
    setPending(null)
    setLiveKeys([])
    setError(null)
  }, [])

  const save = useCallback(async () => {
    if (!pending) return
    setError(null)
    const ok = await window.electronAPI.updateCompanionHotkey(pending)
    if (ok) {
      setRecording(false)
      setPending(null)
      setLiveKeys([])
    } else {
      setError('Could not register — shortcut may conflict with another app.')
    }
  }, [pending])

  // Track keydown/keyup while recording to accumulate the full combo
  useEffect(() => {
    if (!recording) return
    const held = heldRef.current
    const peak = peakRef.current

    const updateLive = () => {
      const parts = [...peak].map(codeToAccelPart)
      // Deduplicate (e.g. ControlLeft + ControlRight → one Ctrl)
      const unique = [...new Set(parts)]
      setLiveKeys(unique)
    }

    const onDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      held.add(e.code)
      peak.add(e.code)
      updateLive()
    }

    const onUp = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      held.delete(e.code)
      // When all keys released → finalize the combo
      if (held.size === 0 && peak.size > 0) {
        const parts = [...new Set([...peak].map(codeToAccelPart))]
        const accel = buildAccelerator(parts)
        setPending(accel)
        peak.clear()
      }
    }

    // If the window loses focus while keys are held, treat it as a full release
    const onBlur = () => {
      if (peak.size > 0) {
        const parts = [...new Set([...peak].map(codeToAccelPart))]
        const accel = buildAccelerator(parts)
        setPending(accel)
      }
      held.clear()
      peak.clear()
    }

    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [recording])

  // Decide what to display: live keys while holding, pending after release, or current saved
  const displayParts: string[] =
    recording && liveKeys.length > 0 && !pending ? liveKeys
    : (pending || currentAccelerator).split('+')

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Keyboard size={14} className="text-white/40" />
          <span className="text-[13px] text-white/65">Toggle AI panel</span>
        </div>

        {!recording ? (
          <button
            onClick={startRecording}
            className="text-[11px] text-white/50 hover:text-white/80 px-2 py-1
              rounded-lg border border-white/[0.08] hover:border-white/[0.15]
              bg-white/[0.04] hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            Record
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={cancel}
              className="text-[11px] text-white/40 hover:text-white/70 px-2 py-1
                rounded-lg border border-white/[0.06] hover:border-white/[0.12]
                transition-colors cursor-pointer"
            >
              Cancel
            </button>
            {pending && (
              <button
                onClick={save}
                className="text-[11px] text-green-400/80 hover:text-green-400 px-2 py-1
                  rounded-lg border border-green-400/20 hover:border-green-400/40
                  bg-green-400/[0.06] hover:bg-green-400/[0.12] transition-colors cursor-pointer"
              >
                Save
              </button>
            )}
          </div>
        )}
      </div>

      {/* Key chips display */}
      <div
        className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg border transition-colors min-h-[38px] ${
          recording
            ? 'border-white/[0.2] bg-white/[0.06]'
            : 'border-white/[0.06] bg-white/[0.03]'
        }`}
      >
        {recording && liveKeys.length === 0 && !pending ? (
          <motion.span
            className="text-[12px] text-white/30 italic"
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            Press your hotkey combination…
          </motion.span>
        ) : (
          displayParts.map((key, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-[10px] text-white/20">+</span>}
              <span
                className="px-2 py-0.5 rounded-md text-[12px] font-mono
                  bg-white/[0.08] border border-white/[0.12] text-white/75"
              >
                {key}
              </span>
            </span>
          ))
        )}
      </div>

      {error && (
        <p className="text-[11px] text-red-400/80">{error}</p>
      )}

      {recording && (
        <p className="text-[10px] text-white/25">
          Hold your keys together, then release. Click Save to apply.
        </p>
      )}
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
