import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cue, Finding, IssueKind } from '@shared/contracts'
import { formatTime } from '../lib/time'

const COLORS: Record<IssueKind, string> = {
  typo: '#F5A623',
  content: '#EF6A6A',
  timing: '#7C9CFF',
  uncertain: '#8B949E'
}

const PRIORITY: IssueKind[] = ['typo', 'content', 'timing', 'uncertain']
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900]

export default function Timeline({
  durationMs,
  currentMs,
  cues,
  findings,
  waveform,
  onSeek
}: {
  durationMs: number
  currentMs: number
  cues: Cue[]
  findings: Finding[]
  waveform: number[] | null
  onSeek: (ms: number) => void
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 78 })
  const pointerDown = useRef(false)

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight })
    })
    observer.observe(element)
    setSize({ width: element.clientWidth, height: element.clientHeight })
    return () => observer.disconnect()
  }, [])

  const cueColors = useMemo(() => {
    const map = new Map<string, IssueKind>()
    for (const finding of findings) {
      for (const cueId of finding.cueIds) {
        const existing = map.get(cueId)
        if (!existing || PRIORITY.indexOf(finding.kind) < PRIORITY.indexOf(existing)) {
          map.set(cueId, finding.kind)
        }
      }
    }
    return map
  }, [findings])

  const ticks = useMemo(() => {
    if (!size.width || durationMs <= 0) return []
    const step = STEPS.find((value) => (value * 1000 * size.width) / durationMs >= 64) ?? 900
    const result: number[] = []
    for (let seconds = 0; seconds * 1000 <= durationMs; seconds += step) {
      result.push(seconds * 1000)
    }
    return result
  }, [size.width, durationMs])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, size.width, size.height)

    const width = size.width
    const height = size.height
    const duration = Math.max(1, durationMs)
    const xOf = (ms: number): number => (ms / duration) * width

    // waveform
    if (waveform && waveform.length) {
      const baseY = height - 6
      const maxHeight = Math.max(10, height - 26)
      const barWidth = Math.max(1, Math.floor(width / waveform.length / 1.6))
      for (let index = 0; index < waveform.length; index += 1) {
        const x = (index / waveform.length) * width
        const amplitude = waveform[index] * maxHeight
        context.fillStyle = xOf(currentMs) >= x ? '#4A5563' : '#333B45'
        context.fillRect(x, baseY - amplitude, barWidth, amplitude)
      }
    }

    // cue blocks
    for (const cue of cues) {
      const x1 = xOf(cue.startMs)
      const x2 = Math.max(x1 + 1.5, xOf(cue.endMs))
      const kind = cueColors.get(cue.id)
      context.fillStyle = kind ? COLORS[kind] : '#39414B'
      context.globalAlpha = kind ? 0.9 : 0.6
      context.fillRect(x1, 2, x2 - x1, 6)
    }
    context.globalAlpha = 1

    // issue markers
    for (const finding of findings) {
      context.fillStyle = COLORS[finding.kind]
      context.fillRect(xOf(finding.startMs), height - 5, 1.5, 5)
    }

    // playhead
    const playheadX = xOf(currentMs)
    context.strokeStyle = '#F0B45E'
    context.lineWidth = 1.5
    context.beginPath()
    context.moveTo(playheadX, 0)
    context.lineTo(playheadX, height)
    context.stroke()
    context.fillStyle = '#F0B45E'
    context.beginPath()
    context.moveTo(playheadX - 4, 0)
    context.lineTo(playheadX + 4, 0)
    context.lineTo(playheadX, 5)
    context.closePath()
    context.fill()
  }, [size, durationMs, currentMs, cues, findings, waveform, cueColors])

  const seekFromClientX = (clientX: number): void => {
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    onSeek(ratio * durationMs)
  }

  return (
    <div
      ref={wrapRef}
      className="h-[98px] w-full select-none overflow-hidden rounded-xl border border-line bg-[#0F1114]"
      onPointerDown={(event) => {
        pointerDown.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        seekFromClientX(event.clientX)
      }}
      onPointerMove={(event) => {
        if (pointerDown.current) seekFromClientX(event.clientX)
      }}
      onPointerUp={(event) => {
        pointerDown.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    >
      <div className="relative h-[20px] border-b border-line/60">
        {ticks.map((tick, index) => (
          <span
            key={tick}
            className="timecode absolute top-0.5 text-[9.5px]"
            style={{
              left: `calc(${(tick / Math.max(1, durationMs)) * 100}% + 3px)`,
              transform: index === ticks.length - 1 ? 'translateX(-100%)' : undefined
            }}
          >
            {formatTime(tick).slice(3)}
          </span>
        ))}
      </div>
      <canvas ref={canvasRef} className="block h-[78px] w-full cursor-crosshair" />
    </div>
  )
}
