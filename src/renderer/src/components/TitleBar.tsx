import { useEffect, useState } from 'react'
import { Captions, Minus, Settings, Square, X } from 'lucide-react'
import { useApp } from '../store/app'
import { cn } from '../lib/utils'

export default function TitleBar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const view = useApp((state) => state.view)
  const setView = useApp((state) => state.setView)
  const videoPath = useApp((state) => state.videoPath)

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizedChange(setMaximized)
  }, [])

  const fileName = videoPath?.split(/[\\/]/).pop()

  return (
    <header className="drag flex h-11 shrink-0 items-center justify-between border-b border-line bg-panel px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Captions size={16} strokeWidth={2.2} />
        </div>
        <span className="text-[13px] font-semibold tracking-wide">字幕校对台</span>
        {fileName && (
          <>
            <span className="text-muted">/</span>
            <span className="truncate text-[12px] text-ink2">{fileName}</span>
          </>
        )}
      </div>

      <div className="no-drag flex items-center gap-1">
        <button
          className={cn('btn btn-ghost btn-icon', view === 'settings' && 'bg-panel3 text-ink')}
          title="设置"
          onClick={() => setView('settings')}
        >
          <Settings size={15} />
        </button>
        <div className="mx-1 h-4 w-px bg-line" />
        <button className="btn btn-ghost btn-icon" title="最小化" onClick={() => window.api.window.minimize()}>
          <Minus size={15} />
        </button>
        <button
          className="btn btn-ghost btn-icon"
          title={maximized ? '还原' : '最大化'}
          onClick={() => window.api.window.toggleMaximize()}
        >
          <Square size={12} />
        </button>
        <button className="btn btn-ghost btn-icon hover:!bg-content/20" title="关闭" onClick={() => window.api.window.close()}>
          <X size={15} />
        </button>
      </div>
    </header>
  )
}
