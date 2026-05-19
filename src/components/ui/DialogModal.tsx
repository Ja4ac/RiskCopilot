import { useEffect, useRef, useCallback } from 'react'

interface DialogModalProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  width?: number
}

/**
 * Native HTML `<dialog>` wrapper.
 * Uses `showModal()` / `close()` for proper focus management, Escape key handling,
 * and native backdrop — eliminates all custom overlay focus bugs in Electron.
 */
export function DialogModal({ open, onClose, children, width = 440 }: DialogModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  // Imperatively control showModal/close
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
    } else if (!open && el.open) {
      el.close()
    }
  }, [open])

  // Close on backdrop click (native dialog only dispatches "close" on Escape)
  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === ref.current) onClose()
  }, [onClose])

  return (
    <dialog
      ref={ref}
      onClick={handleBackdrop}
      onClose={onClose}
      style={{
        padding: 0,
        border: 'none',
        borderRadius: 12,
        background: 'var(--bg, #fff)',
        maxWidth: '90vw',
        width,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        // Remove default dialog styling
        // The ::backdrop is styled via a <style> tag or global CSS
      }}
    >
      <style>{`
        dialog::backdrop {
          background: rgba(0, 0, 0, 0.35);
        }
      `}</style>
      {children}
    </dialog>
  )
}
