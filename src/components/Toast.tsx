interface ToastProps {
  message: string
  kind?: 'success' | 'error' | 'info'
  onClose: () => void
}

export function Toast({ message, kind = 'info', onClose }: ToastProps) {
  if (!message) return null
  return (
    <div className={`toast toast-${kind}`} role="status">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Cerrar mensaje">
        ×
      </button>
    </div>
  )
}
