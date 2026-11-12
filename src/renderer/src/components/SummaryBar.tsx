import type { AnalysisSummary } from '@shared/contracts'
import { cn } from '../lib/utils'

export default function SummaryBar({ summary }: { summary: AnalysisSummary }): React.JSX.Element {
  const tiles = [
    {
      label: '与 ASR 一致度',
      value: `${Math.round(summary.consistency * 100)}%`,
      color: summary.consistency >= 0.9 ? 'var(--color-ok)' : 'var(--color-accent)'
    },
    { label: '疑似错别字', value: summary.counts.typo, color: 'var(--color-typo)' },
    { label: '内容不一致', value: summary.counts.content, color: 'var(--color-content)' },
    { label: '时间轴', value: summary.counts.timing, color: 'var(--color-timing)' },
    { label: 'ASR 不确定', value: summary.counts.uncertain, color: 'var(--color-uncertain)' },
    {
      label: '平均词置信度',
      value: `${Math.round(summary.avgConfidence * 100)}%`,
      color: 'var(--color-play)'
    }
  ]

  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((tile) => (
        <div key={tile.label} className="panel-soft px-2.5 py-2">
          <div className="text-[10px] leading-tight text-muted">{tile.label}</div>
          <div className={cn('mt-1 text-[15px] font-semibold tabular-nums')} style={{ color: tile.color }}>
            {tile.value}
          </div>
        </div>
      ))}
    </div>
  )
}
