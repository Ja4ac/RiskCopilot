import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface DialogModalProps {
  open: boolean
  /** Called when user triggers close (backdrop click, Escape key, X button) */
  onClose: () => void
  children: React.ReactNode
  width?: number
}

/**
 * Portal-based modal overlay with explicit focus management.
 *
 * - Renders into document.body via React portal (no native `<dialog>`)
 * - On open: saves `document.activeElement`, uses requestAnimationFrame
 *   to focus the first `input, select, textarea, [tabindex]:not([tabindex="-1"])`
 * - On close: restores the previously focused element
 * - Escape key and backdrop click both trigger `onClose`
 */
export function DialogModal({ open, onClose, children, width = 440 }: DialogModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // ── Open: save focus, close: restore focus ──
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null
      // Use rAF to ensure DOM is ready, then focus first editable element
      const rafId = requestAnimationFrame(() => {
        const overlay = overlayRef.current
        if (!overlay) return
        const firstInput = overlay.querySelector<HTMLElement>(
          'input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        firstInput?.focus()
      })
      return () => cancelAnimationFrame(rafId)
    } else {
      // Restore focus when modal closes
      const prev = previousFocusRef.current
      if (prev && typeof prev.focus === 'function') {
        // Delay restore to let React commit the close render
        requestAnimationFrame(() => prev.focus())
      }
    }
  }, [open])

  // ── Escape key handler ──
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose])

  // ── Backdrop click ──
  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }, [onClose])

  // ── Prevent body scroll while open ──
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleBackdrop}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.35)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          padding: 0,
          border: 'none',
          borderRadius: 12,
          background: 'var(--bg, #fff)',
          maxWidth: '90vw',
          width,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          outline: 'none',
          maxHeight: '85vh',
          overflow: 'auto',
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
