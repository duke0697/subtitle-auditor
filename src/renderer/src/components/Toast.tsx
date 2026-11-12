import { useEffect } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { useApp } from '../store/app'

export default function Toast(): React.JSX.Element | null {
  const toast = useApp((state) => state.toast)
  const setToast = useApp((state) => state.setToast)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(timer)
  }, [toast, setToast])

  if (!toast) return null

  return (
    <div className="fade-in fixed bottom-5 left-1/2 z-50 flex max-w-[70vw] -translate-x-1/2 items-center gap-2.5 rounded-xl border border-line bg-panel2 px-4 py-2.5 text-[12.5px] shadow-2xl">
      <CheckCircle2 size={15} className="shrink-0 text-ok" />
      <span className="truncate text-ink2">{toast}</span>
      <button className="btn btn-ghost btn-icon h-6 w-6" onClick={() => setToast(null)}>
        <X size={13} />
      </button>
    </div>
  )
}
