import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Loader2,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX
} from 'lucide-react'
import type { Cue } from '@shared/contracts'
import { formatTime } from '../lib/time'
import { cn, toMediaUrl } from '../lib/utils'

export default function Player({
  videoPath,
  previewPath,
  previewProgress,
  currentCue,
  seekTo,
  seekVersion,
  onPreparePreview,
  onTime
}: {
  videoPath: string
  previewPath: string | null
  previewProgress: number
  currentCue: Cue | null
  seekTo: number | null
  seekVersion: number
  onPreparePreview: () => void
  onTime: (ms: number) => void
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [error, setError] = useState(false)
  const [showSubtitle, setShowSubtitle] = useState(true)
  const pendingSeek = useRef<number | null>(null)

  useEffect(() => {
    setError(false)
  }, [videoPath, previewPath])

  useEffect(() => {
    const video = videoRef.current
    if (!video || seekTo === null) return
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(seekTo / 1000, video.duration - 0.05)
      setCurrent(seekTo)
      pendingSeek.current = null
    } else {
      pendingSeek.current = seekTo
    }
  }, [seekTo, seekVersion])

  const handleMetadata = (video: HTMLVideoElement): void => {
    setDuration(video.duration * 1000)
    if (pendingSeek.current !== null) {
      video.currentTime = Math.min(pendingSeek.current / 1000, Math.max(0, video.duration - 0.05))
      setCurrent(pendingSeek.current)
      pendingSeek.current = null
    }
  }

  const toggle = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  const jump = (delta: number): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + delta))
  }

  const toggleFullscreen = (): void => {
    const element = containerRef.current
    if (!element) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void element.requestFullscreen()
  }

  const source = toMediaUrl(previewPath ?? videoPath)

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-line bg-black"
    >
      <video
        key={source}
        ref={videoRef}
        src={source}
        className="h-full w-full object-contain"
        onLoadedMetadata={(event) => handleMetadata(event.currentTarget)}
        onTimeUpdate={(event) => {
          const ms = event.currentTarget.currentTime * 1000
          setCurrent(ms)
          onTime(ms)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setError(true)}
        onClick={toggle}
      />

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
          <AlertTriangle size={22} className="text-accent" />
          <div className="text-[13px] text-ink">当前编码无法由内置播放器直接解码</div>
          <div className="max-w-[420px] text-[11.5px] leading-relaxed text-muted">
            可以生成一个预览代理（H.264/AAC）。长视频转码需要一些时间，完成后会缓存复用。
          </div>
          {previewProgress > 0 && previewProgress < 1 ? (
            <div className="w-[260px]">
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${Math.round(previewProgress * 100)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-accent">
                <Loader2 size={12} className="animate-spin" /> 正在生成预览
              </div>
            </div>
          ) : (
            <button className="btn btn-primary h-8" onClick={onPreparePreview}>
              生成预览代理
            </button>
          )}
        </div>
      )}

      {showSubtitle && currentCue && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 max-w-[82%] -translate-x-1/2 rounded-lg bg-black/70 px-3 py-1.5 text-center text-[15px] leading-snug text-white shadow-lg">
          {currentCue.text}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-8">
        <button className="btn btn-ghost btn-icon h-8 w-8 text-white/90" onClick={toggle}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="btn btn-ghost btn-icon h-7 w-7 text-white/80" onClick={() => jump(-5)}>
          <RotateCcw size={14} />
        </button>
        <button className="btn btn-ghost btn-icon h-7 w-7 text-white/80" onClick={() => jump(5)}>
          <RotateCw size={14} />
        </button>
        <span className="timecode text-white/80">
          {formatTime(current)} / {formatTime(duration)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="btn btn-ghost btn-icon h-7 w-7 text-white/80"
            onClick={() => setShowSubtitle((value) => !value)}
            title="字幕叠加"
          >
            <span className={cn('text-[10px]', showSubtitle ? 'text-accent' : 'text-white/60')}>CC</span>
          </button>
          <button
            className="btn btn-ghost btn-icon h-7 w-7 text-white/80"
            onClick={() => {
              const video = videoRef.current
              if (!video) return
              video.muted = !muted
              setMuted(!muted)
            }}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            className="h-1 w-16 accent-[var(--color-accent)]"
            onChange={(event) => {
              const value = Number(event.target.value)
              setVolume(value)
              if (videoRef.current) videoRef.current.volume = value
            }}
          />
          <select
            className="rounded border border-white/15 bg-black/40 px-1 py-0.5 text-[10.5px] text-white/80 outline-none"
            value={rate}
            onChange={(event) => {
              const value = Number(event.target.value)
              setRate(value)
              if (videoRef.current) videoRef.current.playbackRate = value
            }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-icon h-7 w-7 text-white/80" onClick={toggleFullscreen}>
            <Maximize size={14} />
          </button>
        </div>
      </div>

    </div>
  )
}
