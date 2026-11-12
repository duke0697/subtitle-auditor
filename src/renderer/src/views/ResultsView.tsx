import { useEffect, useMemo } from 'react'
import { CheckCircle2, Download, FileJson, FolderPlus, ScanText, Settings } from 'lucide-react'
import type { Cue, Finding } from '@shared/contracts'
import FilterBar from '../components/FilterBar'
import IssueDetail from '../components/IssueDetail'
import IssueList from '../components/IssueList'
import Player from '../components/Player'
import SummaryBar from '../components/SummaryBar'
import Timeline from '../components/Timeline'
import { formatTime } from '../lib/time'
import { cn } from '../lib/utils'
import { useApp } from '../store/app'

function currentCueOf(cues: Cue[], timeMs: number): { current: Cue | null; next: Cue | null } {
  let current: Cue | null = null
  let next: Cue | null = null
  for (const cue of cues) {
    if (cue.startMs <= timeMs && timeMs < cue.endMs) current = cue
    if (cue.startMs > timeMs && !next) next = cue
  }
  return { current, next }
}

export default function ResultsView(): React.JSX.Element {
  const result = useApp((state) => state.result)
  const selectedIssueId = useApp((state) => state.selectedIssueId)
  const reviewState = useApp((state) => state.reviewState)
  const playerTimeMs = useApp((state) => state.playerTimeMs)
  const seekTo = useApp((state) => state.seekTo)
  const seekVersion = useApp((state) => state.seekVersion)
  const previewPath = useApp((state) => state.previewPath)
  const previewProgress = useApp((state) => state.previewProgress)
  const waveform = useApp((state) => state.waveform)
  const selectIssue = useApp((state) => state.selectIssue)
  const stepIssue = useApp((state) => state.stepIssue)
  const markReview = useApp((state) => state.markReview)
  const setPlayerTime = useApp((state) => state.setPlayerTime)
  const setSeekTo = useApp((state) => state.setSeekTo)
  const preparePreview = useApp((state) => state.preparePreview)
  const loadWaveform = useApp((state) => state.loadWaveform)
  const exportCsv = useApp((state) => state.exportCsv)
  const exportJson = useApp((state) => state.exportJson)
  const resetSession = useApp((state) => state.resetSession)
  const generateSubtitles = useApp((state) => state.generateSubtitles)
  const setView = useApp((state) => state.setView)
  const setToast = useApp((state) => state.setToast)

  useEffect(() => {
    void loadWaveform()
  }, [loadWaveform])

  const filters = useApp((state) => state.filters)
  const list = useMemo<Finding[]>(() => {
    if (!result) return []
    const query = filters.query.trim().toLowerCase()
    return result.findings.filter((finding) => {
      if (filters.kinds.length && !filters.kinds.includes(finding.kind)) return false
      if (filters.severities.length && !filters.severities.includes(finding.severity)) return false
      if (filters.onlyUnreviewed && reviewState[finding.id]) return false
      if (query) {
        const haystack =
          `${finding.subtitleText} ${finding.asrText} ${finding.message} ${finding.suggestion ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [result, filters, reviewState])

  const selected = result?.findings.find((finding) => finding.id === selectedIssueId) ?? null
  const progress = {
    done: Object.keys(reviewState).length,
    total: result?.findings.length ?? 0
  }
  const cues = result?.cues ?? []
  const { current, next } = useMemo(() => currentCueOf(cues, playerTimeMs), [cues, playerTimeMs])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault()
        stepIssue(1)
      } else if (event.key === 'p' || event.key === 'P') {
        event.preventDefault()
        stepIssue(-1)
      } else if (event.key === 'Enter' && selectedIssueId) {
        event.preventDefault()
        markReview(selectedIssueId, 'reviewed')
        stepIssue(1)
      } else if (event.key === 'i' || event.key === 'I') {
        if (!selectedIssueId) return
        event.preventDefault()
        markReview(selectedIssueId, reviewState[selectedIssueId] === 'ignored' ? null : 'ignored')
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        const nextTime = Math.max(0, playerTimeMs - 5000)
        setPlayerTime(nextTime)
        setSeekTo(nextTime)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        const nextTime = playerTimeMs + 5000
        setPlayerTime(nextTime)
        setSeekTo(nextTime)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    markReview,
    playerTimeMs,
    reviewState,
    selectedIssueId,
    setPlayerTime,
    setSeekTo,
    stepIssue
  ])

  if (!result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-[13px] text-ink2">还没有审查结果</div>
        <button className="btn h-8" onClick={resetSession}>
          返回首页
        </button>
      </div>
    )
  }

  const seek = (ms: number): void => {
    setPlayerTime(ms)
    setSeekTo(ms)
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[322px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold">审查结果</div>
            <span className="text-[10.5px] text-muted">{result.findings.length} 条问题</span>
          </div>
          <div className="mt-2.5">
            <SummaryBar summary={result.summary} />
          </div>
        </div>
        <div className="border-b border-line px-3 py-2.5">
          <FilterBar />
        </div>
        <IssueList
          findings={list}
          selectedId={selectedIssueId}
          reviewState={reviewState}
          onSelect={selectIssue}
        />
        <div className="border-t border-line px-4 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-muted">
            <span>已处理</span>
            <span className="tabular-nums">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-ok transition-[width]"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <div className="mt-1.5 text-[10px] text-muted">N/P 切换 · Enter 核对 · I 忽略 · ←/→ 快退快进</div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-2.5 bg-canvas p-3">
        <div className="flex items-center justify-between px-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12.5px] font-medium">
              {result.media.path.split(/[\\/]/).pop()}
            </span>
            <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted">
              {result.model.name} · {result.model.device}
            </span>
            {list.length === 0 && (
              <span className="flex items-center gap-1 text-[11px] text-ok">
                <CheckCircle2 size={12} /> 当前筛选下无问题
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button className="btn h-7 px-2 text-[11px]" onClick={() => void exportCsv()}>
              <Download size={12} /> CSV
            </button>
            <button className="btn h-7 px-2 text-[11px]" onClick={() => void exportJson()}>
              <FileJson size={12} /> JSON
            </button>
            <button className="btn h-7 px-2 text-[11px]" onClick={() => void generateSubtitles()}>
              <ScanText size={12} /> 提取字幕
            </button>
            <button className="btn h-7 px-2 text-[11px]" onClick={resetSession}>
              <FolderPlus size={12} /> 新任务
            </button>
            <button className="btn btn-ghost btn-icon h-7 w-7" onClick={() => setView('settings')}>
              <Settings size={13} />
            </button>
          </div>
        </div>

        <Player
          videoPath={result.media.path}
          previewPath={previewPath}
          previewProgress={previewProgress}
          currentCue={current}
          seekTo={seekTo}
          seekVersion={seekVersion}
          onPreparePreview={() => void preparePreview()}
          onTime={setPlayerTime}
        />

        <Timeline
          durationMs={result.summary.durationMs}
          currentMs={playerTimeMs}
          cues={cues}
          findings={result.findings}
          waveform={waveform}
          onSeek={seek}
        />

        <div className="panel flex items-center gap-3 px-3 py-2">
          <span className="timecode shrink-0">
            {current ? formatTime(current.startMs) : '--:--:--'}
          </span>
          <div className={cn('min-w-0 flex-1 truncate text-[12.5px]', !current && 'text-muted')}>
            {current?.text ?? '当前时间没有字幕'}
          </div>
          {next && (
            <div className="hidden max-w-[40%] shrink-0 items-center gap-2 text-[10.5px] text-muted xl:flex">
              <span>下一句</span>
              <span className="truncate">{next.text}</span>
            </div>
          )}
        </div>
      </section>

      <aside className="w-[362px] shrink-0 border-l border-line bg-panel">
        <IssueDetail
          finding={selected}
          review={selected ? reviewState[selected.id] : undefined}
          onMark={(state) => {
            if (!selected) return
            markReview(selected.id, state)
            if (state === 'reviewed') stepIssue(1)
          }}
          onStep={stepIssue}
          onLocate={() => {
            if (selected) seek(selected.startMs)
          }}
          onToast={setToast}
        />
      </aside>
    </div>
  )
}
