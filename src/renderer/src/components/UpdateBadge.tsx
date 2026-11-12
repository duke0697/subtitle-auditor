import { ArrowDownToLine, CircleAlert, RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'
import { useApp } from '../store/app'

export default function UpdateBadge(): React.JSX.Element | null {
  const update = useApp((state) => state.update)
  const setView = useApp((state) => state.setView)
  if (!update) return null

  const { status, progress, latestVersion, manual } = update
  if (status === 'disabled' || status === 'idle' || status === 'up-to-date') return null
  if (status === 'error' && !manual) return null

  const percent = Math.round(progress?.percent ?? 0)
  const label =
    status === 'checking'
      ? '正在检查更新…'
      : status === 'available'
        ? `发现新版本 v${latestVersion ?? ''}`
        : status === 'downloading'
          ? `正在下载更新 ${percent}%`
          : status === 'downloaded'
            ? '更新已就绪，点击查看'
            : '更新检查失败，点击重试'

  return (
    <button
      className={cn(
        'btn btn-ghost h-[26px] gap-1 px-1.5 text-[10.5px]',
        status === 'downloaded' ? 'text-ok' : status === 'error' ? 'text-content' : 'text-accent'
      )}
      title={label}
      aria-label={label}
      onClick={() => setView('settings')}
    >
      {status === 'error' ? (
        <CircleAlert size={14} />
      ) : status === 'checking' || status === 'downloaded' ? (
        <RefreshCw size={14} className={status === 'checking' ? 'animate-spin' : undefined} />
      ) : (
        <ArrowDownToLine size={14} />
      )}
      {status === 'downloading' && <span className="font-mono">{percent}%</span>}
    </button>
  )
}
