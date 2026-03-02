import { useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useStore, normalizeText } from '../state/store'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { saveCorpusRules } from '../state/documentsPersistence'
import { ENTITY_LABELS, type EntityLabel } from '../types'

// Label chip colors per entity type
const LABEL_COLORS: Record<EntityLabel, string> = {
  PERSON: 'bg-blue-100 text-blue-700',
  ORGANIZATION: 'bg-violet-100 text-violet-700',
  ADDRESS: 'bg-emerald-100 text-emerald-700',
  DATE: 'bg-indigo-100 text-indigo-700',
  IDENTIFIER: 'bg-amber-100 text-amber-700',
}

// ─── AddRuleForm ─────────────────────────────────────────────────────────────

interface AddRuleFormProps {
  withLabel?: boolean
  onAdd: (text: string, label?: EntityLabel) => void
  existingKeys: Set<string>
  label: string
}

function AddRuleForm({ withLabel = false, onAdd, existingKeys, label }: AddRuleFormProps) {
  const { t } = useTranslation()
  const [inputText, setInputText] = useState('')
  const [selectedLabel, setSelectedLabel] = useState<EntityLabel>('PERSON')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = () => {
    const trimmed = inputText.trim()
    if (!trimmed) {
      setError(t('rules.addEmpty'))
      return
    }
    const normalized = normalizeText(trimmed)
    if (existingKeys.has(normalized)) {
      setError(t('rules.addDuplicate'))
      return
    }
    onAdd(normalized, withLabel ? selectedLabel : undefined)
    setInputText('')
    setError(null)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => { setInputText(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
          placeholder={t('rules.addTextPlaceholder')}
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-300 placeholder:text-slate-400"
        />
        {withLabel && (
          <select
            value={selectedLabel}
            onChange={(e) => setSelectedLabel(e.target.value as EntityLabel)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
          >
            {ENTITY_LABELS.map((l) => (
              <option key={l} value={l}>{t(`entities.${l}`)}</option>
            ))}
          </select>
        )}
        <button
          onClick={handleSubmit}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 transition-colors whitespace-nowrap"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {label}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-500 pl-1">{error}</p>
      )}
    </div>
  )
}

// ─── RuleSection ────────────────────────────────────────────────────────────

interface RuleSectionProps {
  title: string
  description: string
  count: number
  noRulesInSection: string
  children: React.ReactNode
  addForm?: React.ReactNode
}

function RuleSection({ title, description, count, noRulesInSection, children, addForm }: RuleSectionProps) {
  const { t } = useTranslation()
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <p className="text-sm text-slate-500 mt-0.5">{description}</p>
        </div>
        <span className="flex-shrink-0 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
          {t('rules.ruleCount', { count })}
        </span>
      </div>
      {count === 0 ? (
        <p className="px-6 py-4 text-sm text-slate-400 italic">{noRulesInSection}</p>
      ) : (
        children
      )}
      {addForm && (
        <div className="border-t border-slate-100 px-6 py-4">
          {addForm}
        </div>
      )}
    </div>
  )
}

// ─── SuppressedTable ─────────────────────────────────────────────────────────

interface SuppressedTableProps {
  items: string[]
  onDelete: (text: string) => void
  columnText: string
  columnActions: string
}

function SuppressedTable({ items, onDelete, columnText, columnActions }: SuppressedTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 bg-slate-50">
          <th className="text-left px-6 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">
            {columnText}
          </th>
          <th className="text-right px-6 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-20">
            {columnActions}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((text) => (
          <tr key={text} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
            <td className="px-6 py-3">
              <span className="font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-xs">
                &ldquo;{text}&rdquo;
              </span>
            </td>
            <td className="px-6 py-3 text-right">
              <button
                onClick={() => onDelete(text)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                aria-label="Delete"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── LabelMapRow ─────────────────────────────────────────────────────────────

interface LabelMapRowProps {
  text: string
  label: EntityLabel
  editLabel: string
  onLabelChange: (text: string, label: EntityLabel) => void
  onDelete: (text: string) => void
}

function LabelMapRow({ text, label, editLabel, onLabelChange, onDelete }: LabelMapRowProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)

  return (
    <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
      <td className="px-6 py-3">
        <span className="font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-xs">
          &ldquo;{text}&rdquo;
        </span>
      </td>
      <td className="px-6 py-3">
        {editing ? (
          <select
            autoFocus
            defaultValue={label}
            onChange={(e) => {
              onLabelChange(text, e.target.value as EntityLabel)
              setEditing(false)
            }}
            onBlur={() => setEditing(false)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
          >
            {ENTITY_LABELS.map((l) => (
              <option key={l} value={l}>
                {t(`entities.${l}`)}
              </option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setEditing(true)}
            title={editLabel}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${LABEL_COLORS[label]}`}
          >
            {t(`entities.${label}`)}
          </button>
        )}
      </td>
      <td className="px-6 py-3 text-right">
        <button
          onClick={() => onDelete(text)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          aria-label="Delete"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

// ─── LabelMapTable ────────────────────────────────────────────────────────────

interface LabelMapTableProps {
  items: [string, EntityLabel][]
  columnText: string
  columnLabel: string
  columnActions: string
  editLabel: string
  onLabelChange: (text: string, label: EntityLabel) => void
  onDelete: (text: string) => void
}

function LabelMapTable({ items, columnText, columnLabel, columnActions, editLabel, onLabelChange, onDelete }: LabelMapTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 bg-slate-50">
          <th className="text-left px-6 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">
            {columnText}
          </th>
          <th className="text-left px-6 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-40">
            {columnLabel}
          </th>
          <th className="text-right px-6 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-20">
            {columnActions}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map(([text, label]) => (
          <LabelMapRow
            key={text}
            text={text}
            label={label}
            editLabel={editLabel}
            onLabelChange={onLabelChange}
            onDelete={onDelete}
          />
        ))}
      </tbody>
    </table>
  )
}

// ─── RulesPage ───────────────────────────────────────────────────────────────

export default function RulesPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)
  const suppressedTexts = useStore((s) => s.suppressedTexts)
  const labelOverrides = useStore((s) => s.labelOverrides)
  const forcedLabels = useStore((s) => s.forcedLabels)
  const removeSuppressedText = useStore((s) => s.removeSuppressedText)
  const removeLabelOverride = useStore((s) => s.removeLabelOverride)
  const removeForcedLabel = useStore((s) => s.removeForcedLabel)
  const suppressText = useStore((s) => s.suppressText)
  const setLabelOverride = useStore((s) => s.setLabelOverride)
  const setForcedLabel = useStore((s) => s.setForcedLabel)

  const suppressedArray = Array.from(suppressedTexts)
  const overridesArray = Array.from(labelOverrides.entries())
  const forcedArray = Array.from(forcedLabels.entries())

  const [pendingDelete, setPendingDelete] = useState<{
    type: 'suppressed' | 'override' | 'forced'
    text: string
  } | null>(null)

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const persistRules = useCallback(async () => {
    const s = useStore.getState()
    await saveCorpusRules({
      suppressedTexts: Array.from(s.suppressedTexts),
      labelOverrides: Array.from(s.labelOverrides.entries()),
      forcedLabels: Array.from(s.forcedLabels.entries()),
    })
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    if (pendingDelete.type === 'suppressed') {
      removeSuppressedText(pendingDelete.text)
    } else if (pendingDelete.type === 'override') {
      removeLabelOverride(pendingDelete.text)
    } else {
      removeForcedLabel(pendingDelete.text)
    }
    setPendingDelete(null)
    await persistRules()
  }, [pendingDelete, removeSuppressedText, removeLabelOverride, removeForcedLabel, persistRules])

  const handleOverrideLabelChange = useCallback(async (text: string, label: EntityLabel) => {
    setLabelOverride(text, label)
    await persistRules()
  }, [setLabelOverride, persistRules])

  const handleForcedLabelChange = useCallback(async (text: string, label: EntityLabel) => {
    setForcedLabel(text, label)
    await persistRules()
  }, [setForcedLabel, persistRules])

  const handleAddSuppressed = useCallback(async (text: string) => {
    suppressText(text)
    await persistRules()
  }, [suppressText, persistRules])

  const handleAddOverride = useCallback(async (text: string, label?: EntityLabel) => {
    if (label) {
      setLabelOverride(text, label)
      await persistRules()
    }
  }, [setLabelOverride, persistRules])

  const handleAddForced = useCallback(async (text: string, label?: EntityLabel) => {
    if (label) {
      setForcedLabel(text, label)
      await persistRules()
    }
  }, [setForcedLabel, persistRules])

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === 'fr' ? 'en' : 'fr')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-bold text-slate-800">
                LBO <span className="text-gradient">Anonymizer</span>
              </h1>
              <span className="text-xs text-slate-400 font-mono">v{__APP_VERSION__}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {/* Language toggle */}
              <button
                onClick={toggleLanguage}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
                <span className="text-sm font-medium">{i18n.language === 'fr' ? 'FR' : 'EN'}</span>
              </button>

              {/* User menu */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100">
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="text-sm font-medium text-slate-700">{user?.username}</span>
              </div>

              {/* Logout */}
              <button
                onClick={() => setShowLogoutConfirm(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="text-sm">{t('documents.logout')}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tab navigation */}
      <nav className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-1 py-1">
            {[
              { to: '/documents', label: t('rules.documentsTab') },
              { to: '/rules', label: t('rules.navTab') },
            ].map(({ to, label }) => (
              <button
                key={to}
                onClick={() => navigate(to)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  location.pathname === to
                    ? 'bg-slate-100 text-slate-800'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Page title */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-800">{t('rules.title')}</h2>
          <p className="text-slate-500 mt-1">{t('rules.subtitle')}</p>
        </div>

        {/* Future-only warning banner */}
        <div className="mb-6 flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
          {t('rules.futureOnlyWarning')}
        </div>

        <div className="flex flex-col gap-6">
          {/* Suppressed texts */}
          <RuleSection
            title={t('rules.suppressedTitle')}
            description={t('rules.suppressedDescription')}
            count={suppressedArray.length}
            noRulesInSection={t('rules.noRulesInSection')}
            addForm={
              <AddRuleForm
                existingKeys={suppressedTexts}
                onAdd={(text) => { void handleAddSuppressed(text) }}
                label={t('rules.addSuppressed')}
              />
            }
          >
            <SuppressedTable
              items={suppressedArray}
              columnText={t('rules.columnText')}
              columnActions={t('rules.columnActions')}
              onDelete={(text) => setPendingDelete({ type: 'suppressed', text })}
            />
          </RuleSection>

          {/* Label overrides */}
          <RuleSection
            title={t('rules.overridesTitle')}
            description={t('rules.overridesDescription')}
            count={overridesArray.length}
            noRulesInSection={t('rules.noRulesInSection')}
            addForm={
              <AddRuleForm
                withLabel
                existingKeys={new Set(labelOverrides.keys())}
                onAdd={(text, label) => { void handleAddOverride(text, label) }}
                label={t('rules.addOverride')}
              />
            }
          >
            <LabelMapTable
              items={overridesArray}
              columnText={t('rules.columnText')}
              columnLabel={t('rules.columnLabel')}
              columnActions={t('rules.columnActions')}
              editLabel={t('rules.editLabel')}
              onLabelChange={handleOverrideLabelChange}
              onDelete={(text) => setPendingDelete({ type: 'override', text })}
            />
          </RuleSection>

          {/* Forced detections */}
          <RuleSection
            title={t('rules.forcedTitle')}
            description={t('rules.forcedDescription')}
            count={forcedArray.length}
            noRulesInSection={t('rules.noRulesInSection')}
            addForm={
              <AddRuleForm
                withLabel
                existingKeys={new Set(forcedLabels.keys())}
                onAdd={(text, label) => { void handleAddForced(text, label) }}
                label={t('rules.addForced')}
              />
            }
          >
            <LabelMapTable
              items={forcedArray}
              columnText={t('rules.columnText')}
              columnLabel={t('rules.columnLabel')}
              columnActions={t('rules.columnActions')}
              editLabel={t('rules.editLabel')}
              onLabelChange={handleForcedLabelChange}
              onDelete={(text) => setPendingDelete({ type: 'forced', text })}
            />
          </RuleSection>
        </div>
      </main>

      {/* Delete confirmation dialog */}
      {pendingDelete && (
        <ConfirmDialog
          title={t('rules.deleteTitle')}
          message={t('rules.deleteMessage', { text: pendingDelete.text })}
          confirmText={t('rules.deleteConfirm')}
          cancelText={t('dialogs.cancel')}
          confirmVariant="danger"
          onConfirm={() => { void handleConfirmDelete() }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* Logout confirmation */}
      {showLogoutConfirm && (
        <ConfirmDialog
          title={t('logoutConfirm.title')}
          message={t('logoutConfirm.message')}
          confirmText={t('logoutConfirm.confirm')}
          cancelText={t('logoutConfirm.cancel')}
          confirmVariant="danger"
          onConfirm={() => {
            logout()
            navigate('/login')
            setShowLogoutConfirm(false)
          }}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      )}
    </div>
  )
}
