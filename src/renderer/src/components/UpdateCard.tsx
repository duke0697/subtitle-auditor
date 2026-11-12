import { useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw, RotateCw } from 'lucide-react'
import { formatBytes } from '../lib/utils'
import { useApp } from '../store/app'

export default function UpdateCard(): React.JSX.Element {
  const update = useApp((state) => state.update)
  const settings = useApp((state) => state.settings)
  const setSettings = useApp((state) => state.setSettings)
  const checkUpdate = useApp((state) => state.checkUpdate)
  const restartUpdate = useApp((state) => state.restartUpdate)
  const busy = useApp((state) => state.jobId !== null || state.ocrProgress !== null)
  const [mirror, setMirror] = useState(settings.updateMirror)

  useEffect(() => setMirror(settings.updateMirror), [settings.updateMirror])

  const status = update?.status ?? 'disabled'
  const progress = update?.progress
  const percent = Math.round(progress?.percent ?? 0)
  const checking = status === 'checking'
  const downloading = status === 'available' || status === 'downloading'
  const downloaded = status === 'downloaded'

  const message = (): string => {
    switch (status) {
      case 'disabled':
        return '开发模式下不支持自动更新'
      case 'idle':
        return '可以手动检查更新'
      case 'checking':
        return '正在检查更新…'
      case 'up-to-date':
        return '当前已是最新版本'
      case 'available':
        return `发现新版本 v${update?.latestVersion ?? ''}，准备下载`
      case 'downloading':
        return progress
          ? `正在下载 ${percent}%（${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}）`
          : '正在下载更新…'
      case 'downloaded':
        return `新版本 v${update?.latestVersion ?? ''} 已下载，点击「立即重启安装」生效`
      case 'error':
        return update?.error ?? '检查更新失败'
    }
  }

  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-center gap-2 text-[12.5px] font-medium">
        <RefreshCw size={14} className="text-accent" /> 软件更新
      </div>

      <div className="flex items-center justify-between text-[11.5px]">
        <span className="text-muted">当前版本</span>
        <span className="timecode">v{update?.currentVersion ?? '—'}</span>
      </div>
      <div className="mt-2 text-[11.5px] text-ink2" role="status" aria-live="polite">
        {message()}
      </div>

      {downloading && progress && (
        <div
          className="mt-2"
          role="progressbar"
          aria-label="更新下载进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-[10.5px] text-muted">
            GitHub 加速镜像前缀（留空则直连）
          </label>
          <input
            className="input"
            value={mirror}
            placeholder="https://ghfast.top/"
            onChange={(event) => setMirror(event.target.value)}
            onBlur={() => void setSettings({ updateMirror: mirror.trim() })}
          />
        </div>
        {downloaded ? (
          <button
            className="btn btn-primary h-8 shrink-0 px-3 text-[11px]"
            disabled={busy}
            onClick={() => void restartUpdate()}
          >
            <RotateCw size={12} /> 立即重启安装
          </button>
        ) : (
          <button
            className="btn h-8 shrink-0 px-3 text-[11px]"
            disabled={status === 'disabled' || checking || downloading}
            onClick={() => void checkUpdate(true)}
          >
            {checking || downloading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            {checking ? '正在检查…' : downloading ? '正在下载…' : '检查更新'}
          </button>
        )}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-muted">
        {downloaded && busy
          ? '分析任务运行中，完成后才能重启安装。'
          : '更新在后台下载，不会中断当前分析任务；重启会关闭当前会话。'}
      </p>
    </section>
  )
}
