import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { DetectedSpan, EntityLabel } from '../types'
import { ENTITY_LABELS, ENTITY_COLORS } from '../types'
import { ConfirmDialog } from './ConfirmDialog'
import { ScopeSelectionDialog, ScopeOption } from './ScopeSelectionDialog'

interface TagPopoverProps {
  span: DetectedSpan
  anchorRect: DOMRect
  instanceCount: number
  hasMultipleDocuments?: boolean
  onChangeLabel: (label: EntityLabel) => void
  onChangeLabelAll: (label: EntityLabel) => void
  onChangeLabelAllDocuments?: (label: EntityLabel) => void
  onRemove: () => void
  onRemoveAll: () => void
  onRemoveAllDocuments?: () => void
  onClose: () => void
}

const POPOVER_WIDTH = 280
const POPOVER_GAP = 8

export function TagPopover({
  span,
  anchorRect,
  instanceCount,
  hasMultipleDocuments = false,
  onChangeLabel,
  onChangeLabelAll,
  onChangeLabelAllDocuments,
  onRemove,
  onRemoveAll,
  onRemoveAllDocuments,
  onClose,
}: TagPopoverProps) {
  const { t } = useTranslation()
  const popoverRef = useRef<HTMLDivElement>(null)
  const [showLabelPicker, setShowLabelPicker] = useState(false)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [showLabelChangeConfirm, setShowLabelChangeConfirm] = useState<EntityLabel | null>(null)
  const [showRemoveScopeDialog, setShowRemoveScopeDialog] = useState(false)
  const [showLabelScopeDialog, setShowLabelScopeDialog] = useState<EntityLabel | null>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  // Calculate optimal position after render
  useLayoutEffect(() => {
    if (!popoverRef.current) return

    const popoverRect = popoverRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let x: number
    let y: number

    // Horizontal positioning: center on anchor, but keep in viewport
    x = anchorRect.left + anchorRect.width / 2 - POPOVER_WIDTH / 2
    x = Math.max(POPOVER_GAP, Math.min(x, viewportWidth - POPOVER_WIDTH - POPOVER_GAP))

    // Vertical positioning: prefer below, fallback to above
    const spaceBelow = viewportHeight - anchorRect.bottom - POPOVER_GAP
    const spaceAbove = anchorRect.top - POPOVER_GAP

    if (spaceBelow >= popoverRect.height || spaceBelow >= spaceAbove) {
      // Position below
      y = anchorRect.bottom + POPOVER_GAP
      // Ensure it doesn't go off screen
      y = Math.min(y, viewportHeight - popoverRect.height - POPOVER_GAP)
    } else {
      // Position above
      y = anchorRect.top - popoverRect.height - POPOVER_GAP
      // Ensure it doesn't go off screen
      y = Math.max(POPOVER_GAP, y)
    }

    setPosition({ x, y })
  }, [anchorRect, showLabelPicker])

  // Close on click outside
  useEffect(() => {
    if (showRemoveConfirm || showLabelChangeConfirm || showRemoveScopeDialog || showLabelScopeDialog) return // Don't close when dialog is open

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Use timeout to avoid closing immediately from the triggering click
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose, showRemoveConfirm, showLabelChangeConfirm, showRemoveScopeDialog, showLabelScopeDialog])

  // Close on escape
  useEffect(() => {
    if (showRemoveConfirm || showLabelChangeConfirm || showRemoveScopeDialog || showLabelScopeDialog) return // Dialog handles its own escape

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose, showRemoveConfirm, showLabelChangeConfirm, showRemoveScopeDialog, showLabelScopeDialog])

  const handleRemoveClick = () => {
    // Always show scope dialog if cross-document handler is available
    // This allows user to choose future documents even with single document
    if (onRemoveAllDocuments) {
      // Show scope dialog with all options
      setShowRemoveScopeDialog(true)
    } else if (instanceCount > 1) {
      setShowRemoveConfirm(true)
    } else {
      onRemove()
    }
  }

  const handleRemoveScopeSelect = (scope: ScopeOption) => {
    setShowRemoveScopeDialog(false)
    switch (scope) {
      case 'this_instance':
        onRemove()
        break
      case 'whole_document':
        onRemoveAll()
        break
      case 'all_documents':
      case 'future_documents':
        // Both all_documents and future_documents trigger the same handler
        // (update entity log + propagate to stored documents)
        onRemoveAllDocuments?.()
        break
    }
    onClose()
  }

  const handleLabelScopeSelect = (scope: ScopeOption) => {
    if (!showLabelScopeDialog) return
    const label = showLabelScopeDialog
    setShowLabelScopeDialog(null)
    switch (scope) {
      case 'this_instance':
        onChangeLabel(label)
        break
      case 'whole_document':
        onChangeLabelAll(label)
        break
      case 'all_documents':
      case 'future_documents':
        // Both all_documents and future_documents trigger the same handler
        // (update entity log + propagate to stored documents)
        onChangeLabelAllDocuments?.(label)
        break
    }
    onClose()
  }

  const getSourceLabel = (source: DetectedSpan['source']): string => {
    return t(`source.${source}`)
  }

  return (
    <>
      <div
        ref={popoverRef}
        className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-dropdown overflow-hidden animate-slide-up"
        style={{
          left: position.x,
          top: position.y,
          width: POPOVER_WIDTH,
        }}
      >
        {/* Color accent bar */}
        <div
          className="h-1"
          style={{ backgroundColor: ENTITY_COLORS[span.label] }}
        />

        {/* Header */}
        <div className="px-4 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${ENTITY_COLORS[span.label]}15` }}
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: ENTITY_COLORS[span.label] }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-800">
                  {t(`entities.${span.label}`)}
                </span>
                {instanceCount > 1 && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-xs text-slate-500">
                    x{instanceCount}
                  </span>
                )}
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-600 mt-2 truncate" title={span.text}>
            "{span.text}"
          </p>
          <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 ${
              span.confidence >= 0.8 ? 'text-success-600' :
              span.confidence >= 0.5 ? 'text-amber-600' : 'text-danger-600'
            }`}>
              {t('popover.confidence', { value: Math.round(span.confidence * 100) })}
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">{getSourceLabel(span.source)}</span>
          </p>
        </div>

        {/* Actions */}
        <div className="p-2">
          {!showLabelPicker ? (
            <>
              <button
                className="w-full px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 rounded-lg flex items-center gap-3 transition-colors"
                onClick={() => setShowLabelPicker(true)}
              >
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                {t('popover.changeLabel')}
              </button>
              <button
                className="w-full px-3 py-2.5 text-left text-sm text-danger-600 hover:bg-danger-50 rounded-lg flex items-center gap-3 transition-colors"
                onClick={handleRemoveClick}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                {t('popover.remove')}
              </button>
            </>
          ) : (
            <div>
              <button
                className="w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-50 rounded-lg flex items-center gap-2 mb-1 transition-colors"
                onClick={() => setShowLabelPicker(false)}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                {t('popover.back')}
              </button>
              <div className="max-h-48 overflow-y-auto">
                {ENTITY_LABELS.map((label) => (
                  <button
                    key={label}
                    className={`
                      w-full px-3 py-2.5 text-left text-sm rounded-lg flex items-center gap-3 transition-colors
                      ${label === span.label
                        ? 'bg-slate-100 text-slate-800'
                        : 'text-slate-600 hover:bg-slate-50'
                      }
                    `}
                    onClick={() => {
                      if (label === span.label) {
                        onClose()
                        return
                      }
                      // Always show scope dialog if cross-document handler is available
                      // This allows user to choose future documents even with single document
                      if (onChangeLabelAllDocuments) {
                        // Show scope dialog with all options
                        setShowLabelScopeDialog(label)
                      } else if (instanceCount > 1) {
                        setShowLabelChangeConfirm(label)
                      } else {
                        onChangeLabel(label)
                        onClose()
                      }
                    }}
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: ENTITY_COLORS[label] }}
                    />
                    {t(`entities.${label}`)}
                    {label === span.label && (
                      <svg className="w-4 h-4 ml-auto text-success-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Remove confirmation dialog */}
      {showRemoveConfirm && (
        <ConfirmDialog
          title={t('dialogs.removeAnnotation')}
          message={t('dialogs.removeAllInstances', { count: instanceCount, text: span.text })}
          confirmText={t('dialogs.removeAll')}
          cancelText={t('dialogs.removeThisOne')}
          tertiaryText={t('dialogs.cancel')}
          confirmVariant="danger"
          onConfirm={() => {
            onRemoveAll()
            setShowRemoveConfirm(false)
          }}
          onCancel={() => {
            onRemove()
            setShowRemoveConfirm(false)
          }}
          onTertiary={() => {
            setShowRemoveConfirm(false)
          }}
        />
      )}

      {/* Label change confirmation dialog */}
      {showLabelChangeConfirm && (
        <ConfirmDialog
          title={t('dialogs.changeLabelTitle')}
          message={t('dialogs.changeLabelMessage', {
            count: instanceCount,
            text: span.text,
            label: t(`entities.${showLabelChangeConfirm}`)
          })}
          confirmText={t('dialogs.changeAll')}
          cancelText={t('dialogs.changeThisOne')}
          tertiaryText={t('dialogs.cancel')}
          confirmVariant="primary"
          onConfirm={() => {
            onChangeLabelAll(showLabelChangeConfirm)
            setShowLabelChangeConfirm(null)
            onClose()
          }}
          onCancel={() => {
            onChangeLabel(showLabelChangeConfirm)
            setShowLabelChangeConfirm(null)
            onClose()
          }}
          onTertiary={() => {
            setShowLabelChangeConfirm(null)
          }}
        />
      )}

      {/* Remove scope selection dialog */}
      {showRemoveScopeDialog && (
        <ScopeSelectionDialog
          title={t('scope.removeTitle')}
          message={t('scope.selectScope')}
          entityText={span.text}
          instanceCount={instanceCount}
          hasMultipleDocuments={hasMultipleDocuments}
          alwaysShowFutureOption={true}
          onSelect={handleRemoveScopeSelect}
          onCancel={() => setShowRemoveScopeDialog(false)}
        />
      )}

      {/* Label change scope selection dialog */}
      {showLabelScopeDialog && (
        <ScopeSelectionDialog
          title={t('scope.changeLabelTitle')}
          message={t('scope.selectScope')}
          entityText={span.text}
          instanceCount={instanceCount}
          hasMultipleDocuments={hasMultipleDocuments}
          alwaysShowFutureOption={true}
          onSelect={handleLabelScopeSelect}
          onCancel={() => setShowLabelScopeDialog(null)}
        />
      )}
    </>
  )
}

interface LabelPickerProps {
  anchorRect: DOMRect
  selectedText: string
  matchCount: number
  hasMultipleDocuments?: boolean
  onSelect: (label: EntityLabel, scope: ScopeOption) => void
  onClose: () => void
}

const LABEL_PICKER_WIDTH = 260

export function LabelPicker({ anchorRect, selectedText, matchCount, hasMultipleDocuments = false, onSelect, onClose }: LabelPickerProps) {
  const { t } = useTranslation()
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [selectedLabel, setSelectedLabel] = useState<EntityLabel | null>(null)
  const [showScopeDialog, setShowScopeDialog] = useState(false)

  // Calculate optimal position after render
  useLayoutEffect(() => {
    if (!popoverRef.current) return

    const popoverRect = popoverRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let x: number
    let y: number

    // Horizontal positioning: center on anchor
    x = anchorRect.left + anchorRect.width / 2 - LABEL_PICKER_WIDTH / 2
    x = Math.max(POPOVER_GAP, Math.min(x, viewportWidth - LABEL_PICKER_WIDTH - POPOVER_GAP))

    // Vertical positioning: prefer below
    const spaceBelow = viewportHeight - anchorRect.bottom - POPOVER_GAP
    const spaceAbove = anchorRect.top - POPOVER_GAP

    if (spaceBelow >= popoverRect.height || spaceBelow >= spaceAbove) {
      y = anchorRect.bottom + POPOVER_GAP
      y = Math.min(y, viewportHeight - popoverRect.height - POPOVER_GAP)
    } else {
      y = anchorRect.top - popoverRect.height - POPOVER_GAP
      y = Math.max(POPOVER_GAP, y)
    }

    setPosition({ x, y })
  }, [anchorRect])

  useEffect(() => {
    if (showScopeDialog) return

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose, showScopeDialog])

  useEffect(() => {
    if (showScopeDialog) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose, showScopeDialog])

  const handleLabelClick = (label: EntityLabel) => {
    setSelectedLabel(label)
    setShowScopeDialog(true)
  }

  return (
    <>
      <div
        ref={popoverRef}
        className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-dropdown overflow-hidden animate-slide-up"
        style={{
          left: position.x,
          top: position.y,
          width: LABEL_PICKER_WIDTH,
        }}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
            {t('popover.selectEntityType')}
          </p>
          <p className="text-sm text-slate-600 mt-1 truncate" title={selectedText}>
            "{selectedText}"
          </p>
          {matchCount > 1 && (
            <p className="text-xs text-primary-600 mt-1">
              {t('popover.matchesFound', { count: matchCount })}
            </p>
          )}
        </div>

        {/* Labels */}
        <div className="p-2 max-h-64 overflow-y-auto">
          {ENTITY_LABELS.map((label) => (
            <button
              key={label}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 rounded-lg flex items-center gap-3 transition-colors"
              onClick={() => handleLabelClick(label)}
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: ENTITY_COLORS[label] }}
              />
              {t(`entities.${label}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Scope selection dialog */}
      {showScopeDialog && selectedLabel && (
        <ScopeSelectionDialog
          title={t('scope.addTitle')}
          message={t('scope.selectScope')}
          entityText={selectedText}
          instanceCount={matchCount}
          hasMultipleDocuments={hasMultipleDocuments}
          alwaysShowFutureOption={true}
          onSelect={(scope) => {
            onSelect(selectedLabel, scope)
            setShowScopeDialog(false)
            setSelectedLabel(null)
          }}
          onCancel={() => {
            setShowScopeDialog(false)
            setSelectedLabel(null)
          }}
        />
      )}
    </>
  )
}
