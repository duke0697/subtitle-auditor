import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, EyeOff } from 'lucide-react'
import type { Finding } from '@shared/contracts'
import type { ReviewState } from '../store/app'
import { KIND_META, SEVERITY_META, cn } from '../lib/utils'
import { formatTime } from '../lib/time'

export default function IssueList({
  findings,
  selectedId,
  reviewState,
  onSelect
}: {
  findings: Finding[]
  selectedId: string | null
  reviewState: Record<string, ReviewState>
  onSelect: (id: string) => void
}): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: findings.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 8
  })

  return (
    <div ref={parentRef} className="scroll-area min-h-0 flex-1">
      {findings.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-[11.5px] text-muted">
          当前筛选条件下没有结果
        </div>
      ) : (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const finding = findings[item.index]
            const meta = KIND_META[finding.kind]
            const severity = SEVERITY_META[finding.severity]
            const state = reviewState[finding.id]
            const selected = finding.id === selectedId
            return (
              <div
                key={finding.id}
                className="absolute left-0 top-0 w-full px-2"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <button
                  className={cn(
                    'relative flex h-[78px] w-full gap-2.5 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors',
                    selected
                      ? 'border-accent/50 bg-accent/[0.07]'
                      : 'border-line bg-panel2 hover:border-[#3a4048] hover:bg-panel3',
                    state && 'opacity-55'
                  )}
                  onClick={() => onSelect(finding.id)}
                >
                  <span
                    className="absolute inset-y-2 left-0 w-[2px] rounded-full"
                    style={{ background: meta.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                      <span className="timecode">{formatTime(finding.startMs)}</span>
                      <span className="ml-auto flex items-center gap-1">
                        {state === 'reviewed' && <Check size={12} className="text-ok" />}
                        {state === 'ignored' && <EyeOff size={12} className="text-muted" />}
                        <span className="text-[10px]" style={{ color: severity.color }}>
                          {severity.label}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink2">
                      {finding.subtitleText || finding.asrText || finding.message}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                      {finding.confidence != null && (
                        <span>词置信度 {Math.round(finding.confidence * 100)}%</span>
                      )}
                      {finding.evidence.pinyin && (
                        <span>拼音 {Math.round(finding.evidence.pinyin.similarity * 100)}%</span>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
