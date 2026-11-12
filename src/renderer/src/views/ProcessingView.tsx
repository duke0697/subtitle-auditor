import { useEffect, useRef } from 'react'
import {
  AudioLines,
  Captions,
  Check,
  FileSearch,
  GitCompareArrows,
  Loader2,
  Square
} from 'lucide-react'
import { cn } from '../lib/utils'
import { formatTime } from '../lib/time'
import { useApp } from '../store/app'
import type { JobStage } from '@shared/contracts'

const STAGES: Array<{ key: JobStage; label: string; icon: typeof FileSearch }> = [
  { key: 'probe', label: '读取媒体', icon: FileSearch },
  { key: 'subtitle', label: '解析字幕', icon: Captions },
  { key: 'asr', label: '语音识别', icon: AudioLines },
  { key: 'align', label: '对齐比对', icon: GitCompareArrows },
  { key: 'done', label: '完成', icon: Check }
]

export default function ProcessingView(): React.JSX.Element {
  const progress = useApp((state) => state.progress)
  const liveSegments = useApp((state) => state.liveSegments)
  const videoPath = useApp((state) => state.videoPath)
  const cancel = useApp((state) => state.cancel)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = transcriptRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [liveSegments])

  const currentIndex = STAGES.findIndex((stage) => stage.key === progress?.stage)
  const percent = Math.round((progress?.progress ?? 0) * 100)

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto max-w-[900px] px-6 py-8">
        <div className="mb-6">
          <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />
            本地处理中 · 不会上传任何媒体
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight">正在审查</h1>
          <p className="mt-1 truncate text-[12px] text-ink2">{videoPath?.split(/[\\/]/).pop()}</p>
        </div>

        <section className="panel mb-4 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12.5px] text-ink2">
              <Loader2 size={14} className="animate-spin text-accent" />
              {progress?.message ?? '准备中…'}
            </div>
            <span className="timecode text-ink">{percent}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-[#f6c273] transition-[width] duration-300"
              style={{ width: `${Math.max(2, percent)}%` }}
            />
          </div>

          <div className="mt-5 grid grid-cols-5 gap-2">
            {STAGES.map((stage, index) => {
              const done = currentIndex > index || progress?.stage === 'done'
              const active = currentIndex === index
              const Icon = stage.icon
              return (
                <div
                  key={stage.key}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 transition-colors',
                    done
                      ? 'border-ok/25 bg-ok/5 text-ok'
                      : active
                        ? 'border-accent/40 bg-accent/5 text-accent'
                        : 'border-line bg-panel2 text-muted'
                  )}
                >
                  <Icon size={15} />
                  <span className="text-[10.5px]">{stage.label}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2 text-[12px] text-ink2">
              <AudioLines size={14} className="text-play" />
              实时转写
              <span className="text-muted">({liveSegments.length} 段)</span>
            </div>
            <span className="text-[10.5px] text-muted">词级置信度将在结果中展示</span>
          </div>
          <div ref={transcriptRef} className="scroll-area h-[320px] p-3">
            {liveSegments.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[12px] text-muted">
                等待第一段识别结果…
              </div>
            ) : (
              <div className="space-y-1">
                {liveSegments.map((segment, index) => (
                  <div
                    key={segment.id}
                    className={cn(
                      'flex gap-3 rounded-lg px-2.5 py-1.5',
                      index === liveSegments.length - 1 ? 'bg-panel2' : ''
                    )}
                  >
                    <span className="timecode mt-0.5 shrink-0">{formatTime(segment.startMs)}</span>
                    <span
                      className={cn(
                        'text-[12.5px] leading-relaxed',
                        index === liveSegments.length - 1 ? 'text-ink' : 'text-ink2'
                      )}
                    >
                      {segment.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="mt-4 flex justify-center">
          <button className="btn h-9 px-4 text-[12.5px]" onClick={() => void cancel()}>
            <Square size={13} /> 取消任务
          </button>
        </div>
      </div>
    </div>
  )
}
