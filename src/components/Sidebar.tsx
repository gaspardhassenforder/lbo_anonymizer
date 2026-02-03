import { useMemo, useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { DetectedSpan, EntityLabel } from '../types'
import { ENTITY_COLORS, ENTITY_LABELS } from '../types'
import { ConfirmDialog } from './ConfirmDialog'
import { ScopeSelectionDialog, ScopeOption } from './ScopeSelectionDialog'

interface SidebarProps {
  spans: DetectedSpan[]
  selectedSpanId: string | null
  confidenceThreshold: number
  onSpanSelect: (spanId: string | null) => void
  onSpanRemove: (spanId: string) => void
  onSpanRemoveAllByText: (normalizedText: string) => void
  onPageNavigate: (pageIndex: number) => void
  onConfidenceChange: (threshold: number) => void
  getInstanceCount: (normalizedText: string) => number
  hasMultipleDocuments?: boolean
  onSpanLabelChange?: (spanId: string, label: EntityLabel) => void
  onSpanLabelChangeAll?: (normalizedText: string, label: EntityLabel) => void
  onSpanRemoveAllDocuments?: (normalizedText: string) => void
  onSpanLabelChangeAllDocuments?: (normalizedText: string, label: EntityLabel) => void
}

// Normalize text for consistent comparison
function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function Sidebar({
  spans,
  selectedSpanId,
  confidenceThreshold,
  onSpanSelect,
  onSpanRemove,
  onSpanRemoveAllByText,
  onPageNavigate,
  onConfidenceChange,
  getInstanceCount,
  hasMultipleDocuments = false,
  onSpanLabelChange,
  onSpanLabelChangeAll,
  onSpanRemoveAllDocuments,
  onSpanLabelChangeAllDocuments,
}: SidebarProps) {
  const { t } = useTranslation()
  const [removeConfirmSpan, setRemoveConfirmSpan] = useState<DetectedSpan | null>(null)
  const [removeScopeSpan, setRemoveScopeSpan] = useState<DetectedSpan | null>(null)
  const [labelScopeSpan, setLabelScopeSpan] = useState<DetectedSpan | null>(null)
  const [labelScopeLabel, setLabelScopeLabel] = useState<EntityLabel | null>(null)
  const [labelPickerSpanId, setLabelPickerSpanId] = useState<string | null>(null)
  const [labelChangeConfirmSpan, setLabelChangeConfirmSpan] = useState<DetectedSpan | null>(null)
  const [labelChangeConfirmLabel, setLabelChangeConfirmLabel] = useState<EntityLabel | null>(null)
  const labelPickerRef = useRef<HTMLDivElement>(null)

  // Close label picker on click outside
  useEffect(() => {
    if (!labelPickerSpanId) return
    const handleClickOutside = (e: MouseEvent) => {
      if (labelPickerRef.current && !labelPickerRef.current.contains(e.target as Node)) {
        setLabelPickerSpanId(null)
      }
    }
    const id = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [labelPickerSpanId])

  // Group spans by label
  const groupedSpans = useMemo(() => {
    const groups = new Map<EntityLabel, DetectedSpan[]>()

    for (const label of ENTITY_LABELS) {
      groups.set(label, [])
    }

    const filteredSpans = spans.filter((s) => s.confidence >= confidenceThreshold)
    for (const span of filteredSpans) {
      groups.get(span.label)?.push(span)
    }

    // Remove empty groups
    for (const [label, labelSpans] of groups) {
      if (labelSpans.length === 0) {
        groups.delete(label)
      }
    }

    return groups
  }, [spans, confidenceThreshold])

  // Count unique entities
  const entityCounts = useMemo(() => {
    const counts: Partial<Record<EntityLabel, number>> = {}
    for (const [label, labelSpans] of groupedSpans) {
      counts[label] = labelSpans.length
    }
    return counts
  }, [groupedSpans])

  // Total entity count
  const totalCount = useMemo(() => {
    return spans.filter((s) => s.confidence >= confidenceThreshold).length
  }, [spans, confidenceThreshold])

  const handleRemoveClick = (span: DetectedSpan) => {
    const instanceCount = getInstanceCount(normalizeText(span.text))
    if (onSpanRemoveAllDocuments) {
      setRemoveScopeSpan(span)
    } else if (instanceCount > 1) {
      setRemoveConfirmSpan(span)
    } else {
      onSpanRemove(span.id)
    }
  }

  const handleRemoveScopeSelect = (scope: ScopeOption) => {
    if (!removeScopeSpan) return
    const norm = normalizeText(removeScopeSpan.text)
    switch (scope) {
      case 'this_instance':
        onSpanRemove(removeScopeSpan.id)
        break
      case 'whole_document':
        onSpanRemoveAllByText(norm)
        break
      case 'all_documents':
      case 'future_documents':
        onSpanRemoveAllDocuments?.(norm)
        break
    }
    setRemoveScopeSpan(null)
  }

  const handleLabelClick = (span: DetectedSpan, label: EntityLabel) => {
    setLabelPickerSpanId(null)
    if (label === span.label) return
    const instanceCount = getInstanceCount(normalizeText(span.text))
    if (onSpanLabelChangeAllDocuments) {
      setLabelScopeSpan(span)
      setLabelScopeLabel(label)
    } else if (instanceCount > 1 && onSpanLabelChangeAll) {
      setLabelChangeConfirmSpan(span)
      setLabelChangeConfirmLabel(label)
    } else if (onSpanLabelChange) {
      onSpanLabelChange(span.id, label)
    }
  }

  const handleLabelScopeSelect = (scope: ScopeOption) => {
    if (!labelScopeSpan || !labelScopeLabel) return
    const norm = normalizeText(labelScopeSpan.text)
    switch (scope) {
      case 'this_instance':
        onSpanLabelChange?.(labelScopeSpan.id, labelScopeLabel)
        break
      case 'whole_document':
        onSpanLabelChangeAll?.(norm, labelScopeLabel)
        break
      case 'all_documents':
      case 'future_documents':
        onSpanLabelChangeAllDocuments?.(norm, labelScopeLabel)
        break
    }
    setLabelScopeSpan(null)
    setLabelScopeLabel(null)
  }

  return (
    <div className="w-80 bg-white border-l border-slate-200 flex flex-col h-full shadow-sm">
      {/* Header */}
      <div className="p-5 border-b border-slate-200">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-slate-800">{t('sidebar.title')}</h2>
          <span className="px-2 py-0.5 rounded-full bg-primary-50 text-primary-600 text-xs font-medium">
            {totalCount}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          {t('sidebar.subtitle')}
        </p>
      </div>

      {/* Confidence threshold slider */}
      <div className="p-5 border-b border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm text-slate-600 font-medium">
            {t('sidebar.confidence')}
          </label>
          <span className="px-2 py-0.5 rounded bg-slate-100 text-primary-600 text-xs font-medium">
            {Math.round(confidenceThreshold * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={confidenceThreshold * 100}
          onChange={(e) => onConfidenceChange(parseInt(e.target.value) / 100)}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-slate-400 mt-1">
          <span>{t('sidebar.confidenceAll')}</span>
          <span>{t('sidebar.confidenceHigh')}</span>
        </div>
      </div>

      {/* Entity list */}
      <div className="flex-1 overflow-y-auto">
        {groupedSpans.size === 0 ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-slate-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <p className="text-slate-600 text-sm">{t('sidebar.noEntities')}</p>
            <p className="text-slate-400 text-xs mt-1">{t('sidebar.noEntitiesHint')}</p>
          </div>
        ) : (
          Array.from(groupedSpans.entries()).map(([label, labelSpans]) => (
            <div key={label} className="border-b border-slate-100">
              {/* Label header */}
              <div className="px-5 py-3 bg-slate-50 flex items-center gap-3 sticky top-0 z-10">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    backgroundColor: ENTITY_COLORS[label],
                  }}
                />
                <span className="text-sm font-medium text-slate-700 flex-1">
                  {t(`entities.${label}`)}
                </span>
                <span className="text-xs text-slate-500">
                  {entityCounts[label]}
                </span>
              </div>

              {/* Spans in this group */}
              <div>
                {labelSpans.map((span) => {
                  const instanceCount = getInstanceCount(normalizeText(span.text))
                  return (
                    <div
                      key={span.id}
                      className={`
                        px-5 py-3 cursor-pointer transition-all duration-150
                        border-l-2 hover:bg-slate-50
                        ${span.id === selectedSpanId
                          ? 'bg-slate-50'
                          : ''
                        }
                      `}
                      style={{
                        borderLeftColor: span.id === selectedSpanId ? ENTITY_COLORS[label] : 'transparent',
                      }}
                      onClick={() => {
                        onSpanSelect(span.id)
                        onPageNavigate(span.pageIndex)
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-slate-800 truncate font-medium" title={span.text}>
                              {span.text}
                            </p>
                            {instanceCount > 1 && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-xs text-slate-500">
                                x{instanceCount}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-500">
                              {t('common.page')}{span.pageIndex + 1}
                            </span>
                            <span className="text-slate-300">·</span>
                            <span className={`text-xs ${
                              span.confidence >= 0.8 ? 'text-success-600' :
                              span.confidence >= 0.5 ? 'text-amber-600' : 'text-danger-600'
                            }`}>
                              {Math.round(span.confidence * 100)}%
                            </span>
                            {span.source === 'user' && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="text-xs text-violet-600">{t('source.user')}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                          {onSpanLabelChange && (
                            <div className="relative" ref={labelPickerSpanId === span.id ? labelPickerRef : undefined}>
                              <button
                                className="p-1.5 rounded-md text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                onClick={() => setLabelPickerSpanId(labelPickerSpanId === span.id ? null : span.id)}
                                title={t('popover.changeLabel')}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                </svg>
                              </button>
                              {labelPickerSpanId === span.id && (
                                <div className="absolute right-0 top-full mt-1 z-50 py-1 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[140px] max-h-48 overflow-y-auto">
                                  {ENTITY_LABELS.map((entityLabel) => (
                                    <button
                                      key={entityLabel}
                                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 rounded-none first:rounded-t-lg last:rounded-b-lg"
                                      style={{ color: span.label === entityLabel ? 'var(--color-primary-600)' : undefined }}
                                      onClick={() => handleLabelClick(span, entityLabel)}
                                    >
                                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ENTITY_COLORS[entityLabel] }} />
                                      {t(`entities.${entityLabel}`)}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          <button
                            className="p-1.5 rounded-md text-slate-400 hover:text-danger-500 hover:bg-danger-50 transition-colors"
                            onClick={() => handleRemoveClick(span)}
                            title={t('popover.remove')}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Remove confirmation dialog (when scope dialog not used) */}
      {removeConfirmSpan && (
        <ConfirmDialog
          title={t('dialogs.removeAnnotation')}
          message={t('dialogs.removeAllInstances', {
            count: getInstanceCount(normalizeText(removeConfirmSpan.text)),
            text: removeConfirmSpan.text
          })}
          confirmText={t('dialogs.removeAll')}
          cancelText={t('dialogs.removeThisOne')}
          tertiaryText={t('dialogs.cancel')}
          confirmVariant="danger"
          onConfirm={() => {
            onSpanRemoveAllByText(normalizeText(removeConfirmSpan.text))
            setRemoveConfirmSpan(null)
          }}
          onCancel={() => {
            onSpanRemove(removeConfirmSpan.id)
            setRemoveConfirmSpan(null)
          }}
          onTertiary={() => {
            setRemoveConfirmSpan(null)
          }}
        />
      )}

      {/* Remove scope selection dialog */}
      {removeScopeSpan && (
        <ScopeSelectionDialog
          title={t('scope.removeTitle')}
          message={t('scope.selectScope')}
          entityText={removeScopeSpan.text}
          instanceCount={getInstanceCount(normalizeText(removeScopeSpan.text))}
          hasMultipleDocuments={hasMultipleDocuments}
          alwaysShowFutureOption
          onSelect={handleRemoveScopeSelect}
          onCancel={() => setRemoveScopeSpan(null)}
        />
      )}

      {/* Label change confirmation (when scope dialog not used) */}
      {labelChangeConfirmSpan && labelChangeConfirmLabel && (
        <ConfirmDialog
          title={t('dialogs.changeLabelTitle')}
          message={t('dialogs.changeLabelMessage', {
            count: getInstanceCount(normalizeText(labelChangeConfirmSpan.text)),
            text: labelChangeConfirmSpan.text,
            label: t(`entities.${labelChangeConfirmLabel}`)
          })}
          confirmText={t('dialogs.changeAll')}
          cancelText={t('dialogs.changeThisOne')}
          tertiaryText={t('dialogs.cancel')}
          confirmVariant="primary"
          onConfirm={() => {
            onSpanLabelChangeAll?.(normalizeText(labelChangeConfirmSpan.text), labelChangeConfirmLabel)
            setLabelChangeConfirmSpan(null)
            setLabelChangeConfirmLabel(null)
          }}
          onCancel={() => {
            onSpanLabelChange?.(labelChangeConfirmSpan.id, labelChangeConfirmLabel)
            setLabelChangeConfirmSpan(null)
            setLabelChangeConfirmLabel(null)
          }}
          onTertiary={() => {
            setLabelChangeConfirmSpan(null)
            setLabelChangeConfirmLabel(null)
          }}
        />
      )}

      {/* Label change scope selection dialog */}
      {labelScopeSpan && labelScopeLabel && (
        <ScopeSelectionDialog
          title={t('scope.changeLabelTitle')}
          message={t('scope.selectScope')}
          entityText={labelScopeSpan.text}
          instanceCount={getInstanceCount(normalizeText(labelScopeSpan.text))}
          hasMultipleDocuments={hasMultipleDocuments}
          alwaysShowFutureOption
          onSelect={handleLabelScopeSelect}
          onCancel={() => {
            setLabelScopeSpan(null)
            setLabelScopeLabel(null)
          }}
        />
      )}
    </div>
  )
}
