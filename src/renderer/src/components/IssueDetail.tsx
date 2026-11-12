import { Check, ChevronDown, ChevronUp, Copy, EyeOff, MapPin } from 'lucide-react'
import type { Finding } from '@shared/contracts'
import type { ReviewState } from '../store/app'
import { KIND_META, SEVERITY_META, cn } from '../lib/utils'
import { formatDelta, formatTime } from '../lib/time'
import { copyText } from '../lib/clipboard'
import DiffText from './DiffText'

export default function IssueDetail({
  finding,
  review,
  onMark,
  onStep,
  onLocate,
  onToast
}: {
  finding: Finding | null
  review: ReviewState | undefined
  onMark: (state: ReviewState | null) => void
  onStep: (delta: number) => void
  onLocate: () => void
  onToast: (message: string) => void
}): React.JSX.Element {
  if (!finding) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel3 text-muted">
          <MapPin size={17} />
        </div>
        <div className="text-[12.5px] text-ink2">选择左侧问题查看证据</div>
        <div className="text-[11px] text-muted">N / P 切换，Enter 标记已核对，I 忽略</div>
      </div>
    )
  }

  const meta = KIND_META[finding.kind]
  const severity = SEVERITY_META[finding.severity]
  const confidence = finding.confidence

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between border-b border-line px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold" style={{ color: meta.color }}>
              {meta.label}
            </span>
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px]"
              style={{ color: severity.color, background: 'var(--color-panel3)' }}
            >
              {severity.label}
            </span>
            {review && (
              <span className="rounded-md bg-ok/10 px-1.5 py-0.5 text-[10px] text-ok">
                {review === 'reviewed' ? '已核对' : '已忽略'}
              </span>
            )}
          </div>
          <div className="timecode mt-1">
            {formatTime(finding.startMs, true)} → {formatTime(finding.endMs, true)}
          </div>
        </div>
        <div className="flex gap-1">
          <button className="btn btn-ghost btn-icon" title="上一处 (P)" onClick={() => onStep(-1)}>
            <ChevronUp size={15} />
          </button>
          <button className="btn btn-ghost btn-icon" title="下一处 (N)" onClick={() => onStep(1)}>
            <ChevronDown size={15} />
          </button>
        </div>
      </div>

      <div className="scroll-area min-h-0 flex-1 space-y-3 p-4">
        <button className="btn h-8 w-full text-[11.5px]" onClick={onLocate}>
          <MapPin size={12} /> 定位到画面
        </button>

        <div>
          <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-muted">字幕原文</div>
          <div className="panel-soft px-3 py-2.5 text-[13px] leading-relaxed">
            <DiffText text={finding.subtitleText} edits={finding.evidence.edits} side="sub" />
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-muted">ASR 识别</div>
          <div className="panel-soft px-3 py-2.5 text-[13px] leading-relaxed text-ink2">
            <DiffText text={finding.asrText} edits={finding.evidence.edits} side="asr" />
          </div>
        </div>

        {finding.evidence.pinyin && (
          <div className="panel-soft px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between text-[10.5px] text-muted">
              <span>拼音证据</span>
              <span>
                {finding.evidence.pinyin.relation === 'homophone'
                  ? '同音'
                  : finding.evidence.pinyin.relation === 'tone'
                    ? '近音（声调差异）'
                    : '受控混淆'}{' '}
                · {Math.round(finding.evidence.pinyin.similarity * 100)}%
              </span>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono text-[11.5px]">
              <div className="truncate text-typo">{finding.evidence.pinyin.sub.join(' ')}</div>
              <span className="text-muted">vs</span>
              <div className="truncate text-ok">{finding.evidence.pinyin.asr.join(' ')}</div>
            </div>
          </div>
        )}

        {confidence != null && (
          <div className="panel-soft px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-muted">
              <span>ASR 词级置信度</span>
              <span className="tabular-nums text-ink2">{Math.round(confidence * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round(confidence * 100)}%`,
                  background:
                    confidence >= 0.9
                      ? 'var(--color-ok)'
                      : confidence >= 0.65
                        ? 'var(--color-accent)'
                        : 'var(--color-content)'
                }}
              />
            </div>
          </div>
        )}

        {finding.evidence.timing && (
          <div className="panel-soft px-3 py-2.5">
            <div className="mb-1.5 text-[10.5px] text-muted">时间偏差</div>
            <div className="flex justify-between font-mono text-[11.5px] text-ink2">
              <span>起点 {formatDelta(finding.evidence.timing.startDriftMs)}</span>
              <span>终点 {formatDelta(finding.evidence.timing.endDriftMs)}</span>
            </div>
            {finding.evidence.timing.globalOffsetMs !== null && (
              <div className="mt-1 text-[10.5px] text-muted">
                已扣除全局偏移 {formatDelta(finding.evidence.timing.globalOffsetMs)}
              </div>
            )}
          </div>
        )}

        {finding.suggestion && (
          <div className="rounded-xl border border-ok/25 bg-ok/5 px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10.5px] text-ok">建议文本（来自 ASR，请人工确认）</span>
              <button
                className="btn btn-ghost h-6 px-1.5 text-[10.5px]"
                onClick={() => {
                  void copyText(finding.suggestion ?? '')
                  onToast('建议文本已复制')
                }}
              >
                <Copy size={11} /> 复制
              </button>
            </div>
            <div className="text-[13px] leading-relaxed text-ink">{finding.suggestion}</div>
          </div>
        )}

        <div className="text-[11px] leading-relaxed text-muted">{finding.message}</div>
        {finding.evidence.note && (
          <div className="text-[10.5px] italic text-muted">{finding.evidence.note}</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
        <button
          className={cn('btn h-9 text-[12px]', review === 'reviewed' && 'border-ok/40 text-ok')}
          onClick={() => onMark(review === 'reviewed' ? null : 'reviewed')}
        >
          <Check size={14} /> {review === 'reviewed' ? '取消已核对' : '已核对 (Enter)'}
        </button>
        <button
          className={cn('btn h-9 text-[12px]', review === 'ignored' && 'border-line text-muted')}
          onClick={() => onMark(review === 'ignored' ? null : 'ignored')}
        >
          <EyeOff size={14} /> {review === 'ignored' ? '取消忽略' : '忽略 (I)'}
        </button>
      </div>
    </div>
  )
}
