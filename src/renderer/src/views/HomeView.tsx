import { useMemo, useState } from 'react'
import {
  AlertCircle,
  Captions,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Download,
  FileVideo,
  FolderOpen,
  Languages,
  Loader2,
  Play,
  RefreshCw,
  ScanText,
  UploadCloud,
  X
} from 'lucide-react'
import { formatBytes, cn } from '../lib/utils'
import { formatDuration } from '../lib/time'
import { useApp } from '../store/app'

const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'avi', 'ts', 'flv', 'webm', 'm4v', 'wmv']
const SUB_EXT = ['srt', 'ass', 'ssa', 'vtt']

function extensionOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

export default function HomeView(): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const videoPath = useApp((state) => state.videoPath)
  const subtitlePath = useApp((state) => state.subtitlePath)
  const media = useApp((state) => state.media)
  const candidates = useApp((state) => state.subtitleCandidates)
  const models = useApp((state) => state.models)
  const settings = useApp((state) => state.settings)
  const modelProgress = useApp((state) => state.modelProgress)
  const ocrProgress = useApp((state) => state.ocrProgress)
  const error = useApp((state) => state.error)
  const chooseVideo = useApp((state) => state.chooseVideo)
  const chooseSubtitle = useApp((state) => state.chooseSubtitle)
  const extractTrack = useApp((state) => state.extractTrack)
  const generateSubtitles = useApp((state) => state.generateSubtitles)
  const downloadModel = useApp((state) => state.downloadModel)
  const setSettings = useApp((state) => state.setSettings)
  const start = useApp((state) => state.start)
  const resetSession = useApp((state) => state.resetSession)
  const setView = useApp((state) => state.setView)

  const model = useMemo(
    () => models.find((item) => item.name === settings.model),
    [models, settings.model]
  )
  const downloading = modelProgress?.name === settings.model
  const ready = Boolean(videoPath && subtitlePath && model?.downloaded)

  const handleFiles = async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files)
      .map((file) => {
        try {
          return window.api.files.pathFor(file)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    const video = list.find((path) => VIDEO_EXT.includes(extensionOf(path)))
    const subtitle = list.find((path) => SUB_EXT.includes(extensionOf(path)))
    if (video) await chooseVideo(video)
    if (subtitle) chooseSubtitle(subtitle)
  }

  const pickVideo = async (): Promise<void> => {
    const path = await window.api.dialog.pickVideo()
    if (path) await chooseVideo(path)
  }

  const pickSubtitle = async (): Promise<void> => {
    const path = await window.api.dialog.pickSubtitle()
    if (path) chooseSubtitle(path)
  }

  if (!videoPath) {
    return (
      <div className="scroll-area h-full px-6">
        <div className="mx-auto flex min-h-full max-w-[900px] flex-col justify-center py-10">
          <div className="mb-8 text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[11.5px] text-ink2">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              本地离线识别 · 不上传视频
            </div>
            <h1 className="text-[30px] font-semibold tracking-tight">
              让字幕与配音<span className="text-accent">逐字对齐</span>
            </h1>
            <p className="mx-auto mt-2 max-w-[660px] text-[13px] leading-relaxed text-ink2">
              自动识别语音，比对字幕错别字、内容差异与时间轴偏移。结论附置信度与拼音证据，由你最终确认。
            </p>
          </div>

          <div
            className={cn(
              'panel relative overflow-hidden rounded-2xl border-dashed p-10 text-center transition-colors',
              dragging ? 'border-accent bg-accent/5' : 'border-line/90 bg-panel/60 hover:border-accent/50'
            )}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              void handleFiles(event.dataTransfer.files)
            }}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,rgba(240,180,94,0.10),transparent_60%)]" />
            <div className="relative">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-panel2 text-accent">
                <UploadCloud size={28} strokeWidth={1.7} />
              </div>
              <h2 className="text-[16px] font-semibold">把视频和字幕拖到这里</h2>
              <p className="mt-1 text-[12.5px] text-ink2">
                支持 MP4 / MKV / MOV 等视频，SRT / ASS / SSA / VTT 字幕；也可自动提取视频内嵌软字幕
              </p>
              <div className="mt-6 flex items-center justify-center gap-2.5">
                <button className="btn btn-primary h-9 px-4" onClick={() => void pickVideo()}>
                  <FileVideo size={15} /> 选择视频
                </button>
                <button className="btn h-9 px-4" onClick={() => void pickSubtitle()}>
                  <Captions size={15} /> 选择字幕
                </button>
              </div>
              <p className="mt-4 text-[11px] text-muted">
                识别模型、专业术语表与检测阈值在
                <button className="mx-1 text-accent hover:underline" onClick={() => setView('settings')}>
                  设置
                </button>
                中调整
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-content/30 bg-content/10 px-4 py-3 text-[12.5px] text-content">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              { step: '01', title: '导入配对', desc: '自动寻找同名字幕，或从视频中提取软字幕轨' },
              { step: '02', title: '语音识别', desc: '本地 Whisper 输出词级时间戳与置信度' },
              { step: '03', title: '逐条核对', desc: '点击问题跳转到画面，确认、忽略或复制建议' }
            ].map((item) => (
              <div key={item.step} className="panel p-4">
                <div className="timecode mb-2 text-accent">{item.step}</div>
                <div className="text-[13px] font-medium">{item.title}</div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-muted">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="scroll-area h-full px-6 py-5">
      <div className="mx-auto max-w-[1280px]">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-content/30 bg-content/10 px-4 py-3 text-[12.5px] text-content">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button className="btn btn-ghost btn-icon h-6 w-6" onClick={resetSession}>
              <X size={13} />
            </button>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5">
          <div className="space-y-4">
            <section className="panel p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ink2">
                  <FileVideo size={14} className="text-accent" /> 视频
                </div>
                <div className="flex gap-1.5">
                  <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={() => void pickVideo()}>
                    <RefreshCw size={12} /> 更换
                  </button>
                  <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={resetSession}>
                    <X size={12} /> 移除
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-play/10 text-play">
                  <Play size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{videoPath.split(/[\\/]/).pop()}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                    {media && (
                      <>
                        <span>{formatDuration(media.durationMs)}</span>
                        <span>
                          {media.width}×{media.height}
                        </span>
                        <span className="uppercase">{media.videoCodec || '未知编码'}</span>
                        <span className="uppercase">{media.audioCodec || '无音轨'}</span>
                        <span>{formatBytes(media.sizeBytes)}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="panel p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ink2">
                  <Captions size={14} className="text-accent" /> 字幕
                </div>
                <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={() => void pickSubtitle()}>
                  <FolderOpen size={12} /> 浏览
                </button>
              </div>

              {subtitlePath ? (
                <div className="panel-soft flex items-center gap-3 p-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Captions size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{subtitlePath.split(/[\\/]/).pop()}</div>
                    <div className="truncate text-[11px] text-muted">{subtitlePath}</div>
                  </div>
                  <span className="rounded-md border border-line px-2 py-0.5 text-[10.5px] uppercase text-ink2">
                    {extensionOf(subtitlePath)}
                  </span>
                  <CheckCircle2 size={16} className="text-ok" />
                </div>
              ) : (
                <div className="panel-soft px-3 py-4 text-[12px] text-muted">
                  尚未选择字幕。可以从下方同名候选或内嵌轨道中选择，也可以手动浏览。
                </div>
              )}

              {videoPath && (
                <button
                  className="btn btn-ghost mt-3 h-9 w-full text-[12px]"
                  disabled={ocrProgress !== null}
                  onClick={() => void generateSubtitles()}
                >
                  <ScanText size={14} /> 从画面提取字幕（OCR）
                </button>
              )}

              {candidates.filter((path) => path !== subtitlePath).length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[11px] text-muted">同名候选</div>
                  <div className="space-y-1">
                    {candidates
                      .filter((path) => path !== subtitlePath)
                      .map((path) => (
                        <button
                          key={path}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-panel3"
                          onClick={() => chooseSubtitle(path)}
                        >
                          <ChevronRight size={13} className="text-muted" />
                          <span className="truncate text-[12px] text-ink2">{path.split(/[\\/]/).pop()}</span>
                          <span className="ml-auto truncate text-[10.5px] text-muted">{path}</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {media && media.subtitleStreams.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
                    <Languages size={12} /> 视频内嵌字幕轨
                  </div>
                  <div className="space-y-1.5">
                    {media.subtitleStreams.map((stream) => (
                      <div
                        key={stream.relativeIndex}
                        className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2"
                      >
                        <span className="text-[11px] text-muted">#{stream.relativeIndex + 1}</span>
                        <span className="text-[12px] text-ink2">
                          {stream.title || stream.language || '未命名字幕轨'}
                        </span>
                        <span className="rounded-md bg-panel3 px-1.5 py-0.5 text-[10px] uppercase text-muted">
                          {stream.codec}
                        </span>
                        <div className="ml-auto">
                          {stream.extractable ? (
                            <button
                              className="btn h-7 px-2 text-[11.5px]"
                              onClick={() => void extractTrack(stream.relativeIndex)}
                            >
                              提取
                            </button>
                          ) : (
                            <span className="text-[10.5px] text-muted">位图字幕，暂不支持</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="panel p-5">
              <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-ink2">
                <Cpu size={14} className="text-accent" /> 识别引擎
              </div>

              <label className="mb-1.5 block text-[11px] text-muted">模型</label>
              <select
                className="input mb-3"
                value={settings.model}
                onChange={(event) => void setSettings({ model: event.target.value })}
              >
                {(models.length ? models : [{ name: settings.model, label: settings.model, sizeBytes: 0, downloaded: false, path: '', recommendedDevice: 'auto' as const }]).map(
                  (item) => (
                    <option key={item.name} value={item.name}>
                      {item.label} {item.downloaded ? '· 已下载' : ''}
                    </option>
                  )
                )}
              </select>

              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-[11px] text-muted">设备</label>
                <button
                  className="text-[10.5px] text-accent hover:underline"
                  onClick={() => setView('settings')}
                >
                  术语表设置
                </button>
              </div>
              <select
                className="input mb-3"
                value={settings.device}
                onChange={(event) =>
                  void setSettings({ device: event.target.value as 'auto' | 'cpu' | 'cuda' })
                }
              >
                <option value="auto">自动（优先 GPU）</option>
                <option value="cpu">仅 CPU</option>
                <option value="cuda">强制 GPU</option>
              </select>

              <div className="panel-soft mb-3 p-3">
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>模型状态</span>
                  <span className={model?.downloaded ? 'text-ok' : 'text-accent'}>
                    {model?.downloaded ? '已就绪' : '需要下载'}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-ink2">
                  {model ? `${model.label} · ${formatBytes(model.sizeBytes)}` : '加载中…'}
                </div>
                {downloading && (
                  <div className="mt-2.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-accent transition-[width]"
                        style={{ width: `${Math.round((modelProgress?.progress ?? 0) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1.5 truncate text-[10.5px] text-muted">
                      {modelProgress?.message}
                    </div>
                  </div>
                )}
                {!model?.downloaded && !downloading && (
                  <button
                    className="btn mt-2.5 h-8 w-full text-[12px]"
                    onClick={() => void downloadModel(settings.model)}
                  >
                    <Download size={13} /> 下载所选模型
                  </button>
                )}
                {downloading && (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-accent">
                    <Loader2 size={12} className="animate-spin" /> 正在下载，请保持网络连接
                  </div>
                )}
              </div>

              <button
                className="btn btn-primary h-10 w-full text-[13px]"
                disabled={!ready}
                onClick={() => void start()}
              >
                <Play size={15} /> 开始审查
              </button>
              {!ready && (
                <p className="mt-2 text-center text-[10.5px] leading-relaxed text-muted">
                  {!videoPath
                    ? '请先选择视频'
                    : !subtitlePath
                      ? '请选择或提取字幕'
                      : '请先下载识别模型'}
                </p>
              )}
            </section>

            <section className="panel p-4">
              <div className="mb-1.5 text-[11.5px] font-medium text-ink2">审查口径</div>
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted">
                <li>· 错别字仅在 ASR 词级置信度高且同音或仅声调差异时提示</li>
                <li>· 声母/韵母混淆只标「近音差异」，不作为错别字结论</li>
                <li>· 低置信度区域只标「不确定」，不下结论</li>
                <li>· 所有结论均为疑似，不会自动改写字幕文件</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}
