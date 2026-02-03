import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  tertiaryText?: string
  confirmVariant?: 'primary' | 'danger'
  onConfirm: () => void
  onCancel: () => void
  onTertiary?: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  tertiaryText,
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
  onTertiary,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        ;(onTertiary || onCancel)()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onCancel, onTertiary])

  // Focus trap and auto-focus confirm button
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog) {
      const confirmButton = dialog.querySelector<HTMLButtonElement>('[data-confirm]')
      confirmButton?.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50"
        onClick={onTertiary || onCancel}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="relative bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        {/* Decorative top accent */}
        <div className={`h-1 ${confirmVariant === 'danger' ? 'bg-danger-500' : 'bg-primary-500'}`} />

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            {confirmVariant === 'danger' ? (
              <div className="w-10 h-10 rounded-xl bg-danger-50 border border-danger-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-danger-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
            ) : (
              <div className="w-10 h-10 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                </svg>
              </div>
            )}
            <h2 id="dialog-title" className="text-lg font-semibold text-slate-800">
              {title}
            </h2>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <p className="text-slate-600 whitespace-pre-wrap leading-relaxed">{message}</p>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3">
          {tertiaryText && onTertiary && (
            <button
              className="
                px-4 py-2.5 text-sm font-medium rounded-lg
                text-slate-500 hover:text-slate-700
                bg-slate-100 hover:bg-slate-200
                border border-slate-200 hover:border-slate-300
                transition-all duration-150
              "
              onClick={onTertiary}
            >
              {tertiaryText}
            </button>
          )}
          <button
            className="
              px-4 py-2.5 text-sm font-medium rounded-lg
              text-slate-600 hover:text-slate-800
              bg-white hover:bg-slate-100
              border border-slate-200 hover:border-slate-300
              transition-all duration-150
            "
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            data-confirm
            className={`
              px-4 py-2.5 text-sm font-medium rounded-lg
              transition-all duration-150
              ${confirmVariant === 'danger'
                ? 'bg-danger-600 hover:bg-danger-700 text-white shadow-sm'
                : 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm'
              }
            `}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
